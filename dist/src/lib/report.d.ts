export type Conclusion = 'failure' | 'neutral' | 'success';
export declare const NO_CHANGES_SUMMARY = "No changes. Your infrastructure matches the configuration.";
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
export declare function resolvePrettyName(prettyFilename: string, prettyNameRegex: RegExp | null, separator: string): PrettyNameResult;
export declare function analyzeDiff(diff: string, prettyFilename: string): DiffCheckOutput;
export declare function sanitizeArtifactName(name: string): string;
export declare function emptyResultsConclusion(noDiffConclusion: string): Conclusion;
export declare function shouldUploadArtifact(text: string | undefined): boolean;
