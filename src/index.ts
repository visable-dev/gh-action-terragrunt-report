import * as core from '@actions/core';
import * as github from '@actions/github';
import {DefaultArtifactClient} from '@actions/artifact';
import * as glob from '@actions/glob';
import {PullRequestEvent} from '@octokit/webhooks-types';
import {promises} from 'fs';
import {
  analyzeDiff,
  emptyResultsConclusion,
  resolvePrettyName,
  sanitizeArtifactName,
  shouldUploadArtifact,
} from './lib/report';

const inputs = {
  github_token: core.getInput('github_token', {required: false}),
  diff_file_suffix: core.getInput('diff_file_suffix', {required: false}),
  search_path: core.getInput('search_path', {required: false}),
  pretty_name_regex: core.getInput('pretty_name_regex', {required: false}),
  pretty_name_separator: core.getInput('pretty_name_separator', {
    required: false,
  }),
  no_diff_conclusion: core.getInput('no_diff_conclusion', {required: false}),
};

const ctx = github.context;

const errorHandler: NodeJS.UncaughtExceptionListener = error => {
  core.setFailed(error);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
};

process.on('uncaughtException', errorHandler);
process.on('unhandledRejection', errorHandler);

let prettyNameRegex: RegExp | null = null;
if (inputs.pretty_name_regex !== '') {
  prettyNameRegex = RegExp(inputs.pretty_name_regex);
  core.info(`Using regex ${prettyNameRegex} to prettify name.`);
}

interface Result {
  filename?: string;
  prettyFilename?: string;
  check: Check;
}

type Conclusion = 'failure' | 'neutral' | 'success';

interface Check {
  name: string;
  conclusion: Conclusion;
  output: {
    title: string;
    summary: string;
    text?: string;
  };
}

async function run() {
  if (ctx.eventName !== 'pull_request') {
    throw 'Cannot execute action outside of pull request!';
  }
  const pullRequestEvent = ctx.payload as PullRequestEvent;
  const pullRequest = pullRequestEvent.pull_request;
  if (pullRequest.state !== 'open') {
    throw 'Cannot execute action on closed pull request!';
  }

  const results: Array<Result> = [];

  const globber = await glob.create(
    `${inputs.search_path}/**/*${inputs.diff_file_suffix}`,
  );
  for await (const filename of globber.globGenerator()) {
    core.info(`Processing file ${filename}`);

    const prettyFilename = filename.replace(inputs.search_path, '');
    const prettyName = resolvePrettyName(
      prettyFilename,
      prettyNameRegex,
      inputs.pretty_name_separator,
    );
    if (prettyName.warning) {
      core.warning(prettyName.warning);
    }

    const diff = `${await promises.readFile(filename)}`;
    console.info(diff.replace(/\n/g, ' '));

    let analyzed;
    try {
      analyzed = analyzeDiff(diff, prettyFilename);
    } catch (error) {
      console.error(diff);
      throw `File ${filename} has wrong format! Please ensure that \`diff_file_suffix\` only points to valid diff files.`;
    }

    results.push({
      filename,
      prettyFilename,
      check: {
        name: prettyName.name,
        conclusion: analyzed.conclusion,
        output: analyzed.output,
      },
    });
  }
  if (results.length === 0) {
    results.push({
      check: {
        name: 'Terragrunt Report',
        conclusion: emptyResultsConclusion(inputs.no_diff_conclusion),
        output: {
          title: 'No diff files found!',
          summary: 'No diff files found!',
          text: 'Please read the [setup instructions](https://github.com/visable-dev/gh-action-terragrunt-report#usage) and ensure that you configured terragrunt correctly!',
        },
      },
    });
  }

  const linkToActionRunOverview = `${ctx.serverUrl}/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs/${ctx.runId}`;

  const octokit = github.getOctokit(inputs.github_token);
  for (const result of results) {
    const check = {
      ...result.check,
      ...ctx.repo,
      head_sha: pullRequest.head.sha,
    };
    if (shouldUploadArtifact(check.output.text) && result.filename) {
      const artifactClient = new DefaultArtifactClient();
      const artifactName = sanitizeArtifactName(check.name);
      await artifactClient.uploadArtifact(
        artifactName,
        [result.filename],
        inputs.search_path,
      );
      check.output.text = `File ${result.prettyFilename} is too big. It was uploaded as an artifact. Please download it from [the actions overview of this run](${linkToActionRunOverview}).`;
    }

    const resp = await octokit.rest.checks.create(check);
    core.info(
      `Created check ${resp.data.name} (${resp.data.id}): ${resp.data.html_url}`,
    );
  }
}

run().catch(error => {
  core.setFailed(error.message);
});
