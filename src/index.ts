import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import {PullRequestEvent} from '@octokit/webhooks-definitions/schema';
import {promises} from 'fs';

const inputs = {
  github_token: core.getInput('github_token', {required: true}),
  diff_file_suffix: core.getInput('diff_file_suffix', {required: true}),
};

const ctx = github.context;
const workspace = process.env.GITHUB_WORKSPACE || '';

const errorHandler: NodeJS.UncaughtExceptionListener = error => {
  core.setFailed(error);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
};

process.on('uncaughtException', errorHandler);
process.on('unhandledRejection', errorHandler);

const diffSummaryRegex =
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

  const prLines = [];

  const globber = await glob.create(`**/*${inputs.diff_file_suffix}`);
  for await (const file of globber.globGenerator()) {
    core.info(`Processing file ${file}`);

    const diff = `${await promises.readFile(file)}`;
    core.info(diff);
    const summary = diff.match(diffSummaryRegex);

    if (summary === null) {
      throw `File ${file} has wrong format! Please ensure that \`diff_file_suffix\` only points to valid diff files.`;
    }
    const summaryLine = `##### Plan: \`${summary[1]}\` to add, \`${summary[2]}\` to change, \`${summary[3]}\` to destroy.`;
    core.info(`SummaryLine: ${summaryLine}`);

    const prettyFilename = file.replace(workspace, '');
    prLines.push(`
#### \`${prettyFilename}\`:
${summaryLine}
<details><summary>Full Plan</summary>

\`\`\`terraform
${diff}
\`\`\`
</details>
`);
  }
  if (prLines.length === 0) {
    prLines.push(`
#### :warning: No matching diff file found!

Please read the [setup instructions](https://github.com/littldr/gh-terragrunt-report-action#usage) and ensure that you configured terragrunt correctly!
`);
  }
  const body = `
### Run #[${ctx.runId}](https://github.com/${ctx.repo.owner}/${
    ctx.repo.repo
  }/actions/runs/${ctx.runId}) from ${ctx.sha} on \`${ctx.ref}\`

${prLines.join('\n')}
`;

  const octokit = github.getOctokit(inputs.github_token);
  await octokit.rest.issues.createComment({
    ...ctx.repo,
    issue_number: pullRequest.number,
    body,
  });
}

run();
