import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import {PullRequestEvent} from '@octokit/webhooks-definitions/schema';
import {Endpoints} from '@octokit/types';
import {promises} from 'fs';

const inputs = {
  github_token: core.getInput('github_token', {required: true}),
  diff_file_suffix: core.getInput('diff_file_suffix', {required: true}),
  search_path: core.getInput('search_path', {required: true}),
  pretty_name_regex: core.getInput('pretty_name_regex', {required: false}),
  pretty_name_separator: core.getInput('pretty_name_separator', {
    required: false,
  }),
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

const diffChangeRegex =
  /^Plan: (\d+) to add, (\d+) to change, (\d+) to destroy./m;

async function run() {
  if (ctx.eventName !== 'pull_request') {
    throw 'Cannot execute action outside of pull request!';
  }
  const pullRequestEvent = ctx.payload as PullRequestEvent;
  const pullRequest = pullRequestEvent.pull_request;
  if (pullRequest.state !== 'open') {
    throw 'Cannot execute action on closed pull request!';
  }

  const checks: Array<
    Endpoints['POST /repos/{owner}/{repo}/check-runs']['parameters']
  > = [];

  const globber = await glob.create(
    `${inputs.search_path}/**/*${inputs.diff_file_suffix}`
  );
  for await (const file of globber.globGenerator()) {
    core.info(`Processing file ${file}`);

    const diff = `${await promises.readFile(file)}`;
    let plan = {
      add: 0,
      change: 0,
      destroy: 0,
    };

    if (
      !diff.match('No changes. Your infrastructure matches the configuration.')
    ) {
      // Diff is supposed to contain some changes
      const res = diff.match(diffChangeRegex);
      if (res === null) {
        console.error(diff);
        throw `File ${file} has wrong format! Please ensure that \`diff_file_suffix\` only points to valid diff files.`;
      }
      plan = {
        add: Number(res[1]),
        change: Number(res[2]),
        destroy: Number(res[3]),
      };
    }

    const summary = `Plan: ${plan.add} to add, ${plan.change} to change, ${plan.destroy} to destroy.`;

    core.info(`Summary: ${summary}`);

    const prettyFilename = file.replace(inputs.search_path, '');
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

    let conclusion: 'success' | 'neutral' = 'success';
    if (plan.add > 0 || plan.change > 0 || plan.destroy > 0) {
      conclusion = 'neutral';
    }
    checks.push({
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
    });
  }
  if (checks.length === 0) {
    checks.push({
      ...ctx.repo,
      head_sha: pullRequest.head.sha,
      name: 'Terragrunt Report',
      conclusion: 'failure',
      output: {
        title: 'No diff files found!',
        summary: 'No diff files found!',
        text: 'Please read the [setup instructions](https://github.com/visable-dev/gh-action-terragrunt-report#usage) and ensure that you configured terragrunt correctly!',
      },
    });
  }

  const octokit = github.getOctokit(inputs.github_token);
  for (const check of checks) {
    const result = await octokit.rest.checks.create(check);
    core.info(
      `Created check ${result.data.name} (${result.data.id}): ${result.data.html_url}`
    );
  }
}

run();
