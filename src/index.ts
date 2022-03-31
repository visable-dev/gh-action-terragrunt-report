import * as core from '@actions/core';
import * as github from '@actions/github';
import * as artifact from '@actions/artifact';
import * as glob from '@actions/glob';
import {PullRequestEvent} from '@octokit/webhooks-definitions/schema';
import {promises} from 'fs';

const inputs = {
  github_token: core.getInput('github_token', {required: true}),
  diff_file_suffix: core.getInput('diff_file_suffix', {required: true}),
  search_path: core.getInput('search_path', {required: true}),
  pretty_name_regex: core.getInput('pretty_name_regex', {required: false}),
  pretty_name_separator: core.getInput('pretty_name_separator', {
    required: false,
  }),
  no_diff_conclusion: core.getInput('no_diff_conclusion', {required: false}),
};

const ctx = github.context;

const errorHandler: NodeJS.UncaughtExceptionListener = error => {
  core.setFailed(error);
  // eslint-disable-next-line no-process-exit
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
  [parameter: string]: unknown;
  owner: string;
  repo: string;
  head_sha: string;
  name: string;
  conclusion: Conclusion;
  output: {
    title: string;
    summary: string;
    text?: string;
  };
}

const diffChangeRegex =
  /^Plan: (\d+) to add, (\d+) to change, (\d+) to destroy./m;

const noChangesStr = "No changes. Your infrastructure matches the configuration."

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
    `${inputs.search_path}/**/*${inputs.diff_file_suffix}`
  );
  for await (const filename of globber.globGenerator()) {
    core.info(`Processing file ${filename}`);

    const prettyFilename = filename.replace(inputs.search_path, '');
    let name = prettyFilename;

    if (prettyNameRegex) {
      const matches = prettyFilename.match(prettyNameRegex);
      if (matches) {
        name = matches
          .slice(1) // Skip first entry
          .filter(n => n) // filter undefined capture groups
          .join(inputs.pretty_name_separator); // join with defined separator
      } else {
        core.warning(
          `No match found for filename '${prettyFilename} with pretty_name_regex ${prettyNameRegex}.'`
        );
      }
    }

    const diff = `${await promises.readFile(filename)}`;
    let plan = {
      add: 0,
      change: 0,
      destroy: 0,
    };

    if (diff.match(noChangesStr)) {
      results.push({
        filename,
        prettyFilename,
        check: {
          ...ctx.repo,
          head_sha: pullRequest.head.sha,
          name: name,
          conclusion: "success",
          output: {
            summary: noChangesStr,
            title: noChangesStr
          }
        }
      })
      continue
    }
    
    // Diff is supposed to contain some changes
    const res = diff.match(diffChangeRegex);
    if (res === null) {
      console.error(diff);
      throw `File ${filename} has wrong format! Please ensure that \`diff_file_suffix\` only points to valid diff files.`;
    }
    plan = {
      add: Number(res[1]),
      change: Number(res[2]),
      destroy: Number(res[3]),
    };

    const summary = `Plan: ${plan.add} to add, ${plan.change} to change, ${plan.destroy} to destroy.`;

    core.info(`Summary: ${summary}`);

    let conclusion: 'success' | 'neutral' = 'success';
    if (plan.add > 0 || plan.change > 0 || plan.destroy > 0) {
      conclusion = 'neutral';
    }

    results.push({
      filename,
      prettyFilename,
      check: {
        ...ctx.repo,
        head_sha: pullRequest.head.sha,
        name: name,
        conclusion: conclusion,
        output: {
          title: summary,
          summary: `Please find below the full plan for \`${prettyFilename}\`.`,
          text: `
\`\`\`terraform
${diff}
\`\`\`
`,
        },
      },
    });
  }
  if (results.length === 0) {
    let conclusion: Conclusion = 'failure';
    if (inputs.no_diff_conclusion === 'success') {
      conclusion = inputs.no_diff_conclusion;
    }
    results.push({
      check: {
        ...ctx.repo,
        head_sha: pullRequest.head.sha,
        name: 'Terragrunt Report',
        conclusion: conclusion,
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
    const check = result.check;
    if (check.output.text && check.output.text.length > 65535 && result.filename) {
      // output.text cannot be bigger than 65535, therefore upload diff file as artifact
      // and replace output.text with hint
      const artifactClient = artifact.create();
      // Following characters are not allowed as artifact name: Double quote ", Colon :, Less than <, Greater than >, Vertical bar |, Asterisk *, Question mark ?, Carriage return \r, Line feed \n, Backslash \, Forward slash /
      // See: https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/path-and-artifact-name-validation.ts#L11
      const artifactName = check.name.replace(/[/\\<>"':|*?\r\n]/g, '-');
      await artifactClient.uploadArtifact(
        artifactName,
        [result.filename],
        inputs.search_path,
        {continueOnError: true}
      );
      check.output.text = `File ${result.prettyFilename} is too big. It was uploaded as an artifact. Please download it from [the actions overview of this run](${linkToActionRunOverview}).`;
    }

    const resp = await octokit.rest.checks.create(check);
    core.info(
      `Created check ${resp.data.name} (${resp.data.id}): ${resp.data.html_url}`
    );
  }
}

run();
