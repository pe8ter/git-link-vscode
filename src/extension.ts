import * as vscode from 'vscode';
import { GitExtension } from './git';

const SUCCESS_MESSAGE = 'Remote Git link copied to clipboard';
const FAILURE_MESSAGE = 'Could not copy remote Git link to clipboard because';

const GITHUB_SSH_REMOTE_REGEXP = /^git@github.com:(.*)\/(.*).git$/;
const GITHUB_HTTPS_REMOTE_REGEXP = /^https:\/\/github.com\/(.*)\/(.*).git$/;
const BITBUCKET_SSH_REMOTE_REGEXP = /^git@bitbucket.org:(.*)\/(.*).git$/;
const BITBUCKET_HTTPS_REMOTE_REGEXP = /^https:\/\/(.*)@bitbucket.org\/(.*)\/(.*).git$/;

// Store a line range with one-based indexing. We use this instead of VS Codes's Range
// because this one is easier to work with given such a simple use case.
interface LineRange {
	start: number;
	end: number;
}

/**
 * The VS Code plugin system uses this hook as an entry point to the plugin.
 */

export function activate(context: vscode.ExtensionContext): void {
	const disposable = vscode.commands.registerCommand('git-link.copyRemoteGitRepositoryLink', main);
	context.subscriptions.push(disposable);
}

/**
 * The VS Code plugin system uses this hook so you can clean up resources if necessary.
 */

 export function deactivate(): void {
	// tacit
}

/**
 * Core functionality of the plugin. Pull together all of the necessary repo data and construct a link.
 */

function main(): void {
	const git = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports?.getAPI(1);
	if (!git) {
		vscode.window.showErrorMessage(`${FAILURE_MESSAGE} VS Code's Git extension is not active.`);
		return;
	}

	const remote = git.repositories[0].state.remotes[0];
	if (!remote) {
		vscode.window.showErrorMessage(`${FAILURE_MESSAGE} there are no remotes.`);
		return;
	}

	// If there's a remote object, there should be one or both fetch/push remote URLs, never neither.
	const remoteUrl = (remote?.fetchUrl || remote?.pushUrl)!;

	const commitHash = git.repositories[0].state.HEAD?.commit;
	if (!commitHash) {
		vscode.window.showErrorMessage(`${FAILURE_MESSAGE} there is no HEAD.`);
		return;
	}

	if (!vscode.window.activeTextEditor) {
		vscode.window.showErrorMessage(`${FAILURE_MESSAGE} there is no active editor.`);
		return;
	}

	const fileUri = vscode.window.activeTextEditor.document.uri;
	const relativeFilePath = vscode.workspace.asRelativePath(fileUri);

	const selections = vscode.window.activeTextEditor.selections;
	const selectionRange = unionSelectionRange(selections);

	let gitLink = '';

	if (isGitHubRemote(remoteUrl)) {
		gitLink = createGitHubLink(remoteUrl, commitHash, relativeFilePath, selectionRange);
	} else if (isBitbucketRemote(remoteUrl)) {
		gitLink = createBitbucketLink(remoteUrl, commitHash, relativeFilePath, selectionRange);
	}

	if (!gitLink) {
		vscode.window.showErrorMessage(`${FAILURE_MESSAGE} the remote Git host is unknown.`);
		return;
	}

	// We did it!
	vscode.env.clipboard.writeText(gitLink);

	const gitStatusIsClean = git.repositories[0].state.workingTreeChanges.length === 0;

	if (gitStatusIsClean) {
		vscode.window.showInformationMessage(`${SUCCESS_MESSAGE}.`);
	} else {
		vscode.window.showWarningMessage(`${SUCCESS_MESSAGE}, but there are local changes so the link may be incorrect.`);
	}
}

/**
 * Compute the union of all text selections.
 */

function unionSelectionRange(selections: readonly vscode.Selection[]): LineRange {
	let totalRange = selections[0] as vscode.Range;

	for (let i = 1; i < selections.length; ++i) {
		totalRange = totalRange.union(selections[i]);
	}

	// Opinionated call: Shave off the final trailing [CR]LF. If I highlight an entire line including the [CR]LF, then
	// the cursor is technically on two lines. Even so, I would want this extension to output a link with only one line.
	const hasTrailingCrLf = !totalRange.isSingleLine && totalRange.end.character === 0;

	const start = totalRange.start.line + 1;
	const end = totalRange.end.line + (hasTrailingCrLf ? 0 : 1);

	return { start, end };
}

/**
 * Create a link formatted specifically for GitHub.
 */

 function createGitHubLink(remoteUrl: string, commitHash: string, relativeFilePath: string, selectionRange: LineRange): string {
	const sshRemoteRegexpResult = GITHUB_SSH_REMOTE_REGEXP.exec(remoteUrl);
	const httpsRemoteRegexpResult = GITHUB_HTTPS_REMOTE_REGEXP.exec(remoteUrl);
	const remoteRegExpResult = sshRemoteRegexpResult || httpsRemoteRegexpResult;

	if (!remoteRegExpResult) {
		return '';
	}

	const userName = remoteRegExpResult[1];
	const projectName = remoteRegExpResult[2];

	const firstLine = 'L' + selectionRange.start;
	const secondLine = (selectionRange.start === selectionRange.end) ? '' : `-L${selectionRange.end}`;

	return `https://github.com/${userName}/${projectName}/blob/${commitHash}/${relativeFilePath}#${firstLine}${secondLine}`;
}

/**
 * Create a link formatted specifically for Bitbucket.
 */

 function createBitbucketLink(remoteUrl: string, commitHash: string, relativeFilePath: string, selectionRange: LineRange): string {
	const sshRemoteRegexpResult = BITBUCKET_SSH_REMOTE_REGEXP.exec(remoteUrl);
	const httpsRemoteRegexpResult = BITBUCKET_HTTPS_REMOTE_REGEXP.exec(remoteUrl);

	let userName = '';
	let projectName = '';

	if (sshRemoteRegexpResult) {
		userName = sshRemoteRegexpResult[1];
		projectName = sshRemoteRegexpResult[2];
	} else if (httpsRemoteRegexpResult) {
		userName = httpsRemoteRegexpResult[2];
		projectName = httpsRemoteRegexpResult[3];
	} else {
		return '';
	}

	const firstLine = selectionRange.start;
	const secondLine = (selectionRange.start === selectionRange.end) ? '' : `:${selectionRange.end}`;

	return `https://bitbucket.org/${userName}/${projectName}/src/${commitHash}/${relativeFilePath}#lines-${firstLine}${secondLine}`;
}

/**
 * Check if the remote URL is for GitHub.
 */

 function isGitHubRemote(remoteUrl: string): boolean {
	return GITHUB_SSH_REMOTE_REGEXP.test(remoteUrl) || GITHUB_HTTPS_REMOTE_REGEXP.test(remoteUrl);
}

/**
 * Check if the remote URL is for Bitbucket.
 */

 function isBitbucketRemote(remoteUrl: string): boolean {
	return BITBUCKET_SSH_REMOTE_REGEXP.test(remoteUrl) || BITBUCKET_HTTPS_REMOTE_REGEXP.test(remoteUrl);
}
