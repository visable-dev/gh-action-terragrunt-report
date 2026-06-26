export type Conclusion = 'failure' | 'neutral' | 'success';

export const NO_CHANGES_SUMMARY =
  'No changes. Your infrastructure matches the configuration.';

const ONLY_OUTPUT_CHANGED =
  'You can apply this plan to save these new output values to the Terraform state, without changing any real infrastructure.';

const diffChangeRegex =
  /^Plan: (\d+) to add, (\d+) to change, (\d+) to destroy./m;

export interface PrettyNameResult {
  name: string;
  warning?: string;
}

export interface DiffCheckOutput {
  conclusion: 'success' | 'neutral';
  output: {
    title: string;
    summary: string;
    text?: string;
  };
}

export function resolvePrettyName(
  prettyFilename: string,
  prettyNameRegex: RegExp | null,
  separator: string,
): PrettyNameResult {
  if (!prettyNameRegex) {
    return {name: prettyFilename};
  }

  const matches = prettyFilename.match(prettyNameRegex);
  if (matches) {
    return {
      name: matches
        .slice(1)
        .filter((group): group is string => Boolean(group))
        .join(separator),
    };
  }

  return {
    name: prettyFilename,
    warning: `No match found for filename '${prettyFilename}' with pretty_name_regex ${prettyNameRegex}.`,
  };
}

export function analyzeDiff(
  diff: string,
  prettyFilename: string,
): DiffCheckOutput {
  const diffWithoutNewlines = diff.replace(/\n/g, ' ');
  if (
    diffWithoutNewlines.includes(NO_CHANGES_SUMMARY) ||
    diffWithoutNewlines.includes(ONLY_OUTPUT_CHANGED)
  ) {
    return {
      conclusion: 'success',
      output: {
        summary: NO_CHANGES_SUMMARY,
        title: NO_CHANGES_SUMMARY,
      },
    };
  }

  const planMatch = diff.match(diffChangeRegex);
  if (planMatch === null) {
    throw new Error(
      'File has wrong format! Please ensure that `diff_file_suffix` only points to valid diff files.',
    );
  }

  const plan = {
    add: Number(planMatch[1]),
    change: Number(planMatch[2]),
    destroy: Number(planMatch[3]),
  };
  const summary = `Plan: ${plan.add} to add, ${plan.change} to change, ${plan.destroy} to destroy.`;
  const conclusion =
    plan.add > 0 || plan.change > 0 || plan.destroy > 0 ? 'neutral' : 'success';

  return {
    conclusion,
    output: {
      title: summary,
      summary: `Please find below the full plan for \`${prettyFilename}\`.`,
      text: `
\`\`\`terraform
${diff}
\`\`\`
`,
    },
  };
}

export function sanitizeArtifactName(name: string): string {
  return name.replace(/[/\\<>"':|*?\r\n]/g, '-');
}

export function emptyResultsConclusion(noDiffConclusion: string): Conclusion {
  return noDiffConclusion === 'success' ? 'success' : 'failure';
}

export function shouldUploadArtifact(text: string | undefined): boolean {
  return Boolean(text && text.length > 65535);
}
