import { basename } from "path";
import { commands, Disposable, ExtensionContext, TextDocument, TextDocumentChangeEvent, TextEditor, ViewColumn, WebviewPanel, window, workspace } from "vscode";

import { fixImages, isMJMLFile, mjmlToHtml, compileHtml } from "./helper";

export default class Preview {

    private openedDocuments: string[] = [];
    private previewOpen: boolean = false;
    private subscriptions: Disposable[];
    private webview: WebviewPanel | undefined;

    constructor(context: ExtensionContext) {
        this.subscriptions = context.subscriptions;

        this.subscriptions.push(
            commands.registerCommand("mjml.previewToSide", () => {
                if (window.activeTextEditor) {
                    this.previewOpen = true;
                    this.displayWebView(window.activeTextEditor.document);
                } else {
                    window.showErrorMessage("Active editor doesn't show a MJML document.");
                }
            }),

            workspace.onDidOpenTextDocument(async (document?: TextDocument) => {
                if (document && this.previewOpen && workspace.getConfiguration("mjml").autoPreview) {
                    await this.displayWebView(document);
                }
            }),

            window.onDidChangeActiveTextEditor(async (editor?: TextEditor) => {
                if (editor && this.previewOpen && workspace.getConfiguration("mjml").autoPreview) {
                    await this.displayWebView(editor.document);
                }
            }),

            workspace.onDidChangeTextDocument(async (event?: TextDocumentChangeEvent) => {
                if (event && this.previewOpen && workspace.getConfiguration("mjml").updateWhenTyping) {
                    await this.displayWebView(event.document);
                }
            }),

            workspace.onDidSaveTextDocument(async (document?: TextDocument) => {
                if (document && this.previewOpen) {
                    await this.displayWebView(document);
                }
            }),

            workspace.onDidCloseTextDocument((document?: TextDocument) => {
                if (document && this.previewOpen && this.webview) {
                    this.removeDocument(document.fileName);

                    if (this.openedDocuments.length === 0 && workspace.getConfiguration("mjml").autoClosePreview) {
                        this.dispose();
                    }
                }
            })
        );
    }

    public dispose(): void {
        if (this.webview !== undefined) {
            this.webview.dispose();
        }
    }

    private async displayWebView(document: TextDocument): Promise<void> {
        if (!isMJMLFile(document)) {
            return;
        }

        const activeTextEditor: TextEditor | undefined = window.activeTextEditor;
        if (!activeTextEditor || !activeTextEditor.document) {
            return;
        }

        const content: string = await this.getContent(document);
        const label: string = `MJML Preview - ${basename(activeTextEditor.document.fileName)}`;

        if (!this.webview) {
            this.webview = window.createWebviewPanel("mjml-preview", label, ViewColumn.Two, {
                retainContextWhenHidden: true
            });

            this.webview.webview.html = content;

            this.webview.onDidDispose(() => {
                this.webview = undefined;
                this.previewOpen = false;
            }, null, this.subscriptions);

            if (workspace.getConfiguration("mjml").preserveFocus) {
                // Preserve focus of Text Editor after preview open
                window.showTextDocument(activeTextEditor.document, ViewColumn.One);
            }
        } else {
            this.webview.title = label;
            this.webview.webview.html = content;
        }
    }

    private async getContent(document: TextDocument): Promise<string> {
      let html: string;

      try {
        html = await compileHtml(document.getText());
      } catch (err) {
        return this.error(err.toString());
      }

      html = mjmlToHtml(html, false, false, document.uri.fsPath, "skip").html;

      if (html) {
          this.addDocument(document.fileName);

          return this.setBackgroundColor(fixImages(html, document.uri.fsPath));
      }

      return this.error("Active editor doesn't show a MJML document.");
    }

    private setBackgroundColor(html: string): string {
        if (workspace.getConfiguration("mjml").previewBackgroundColor) {
            const tmp: RegExpExecArray | null = /<.*head.*>/i.exec(html);

            if (tmp && tmp[0]) {
                html = html.replace(tmp[0], `${tmp[0]}\n<style>
                    html, body { background-color: ${workspace.getConfiguration("mjml").previewBackgroundColor}; }
                </style>`);
            }
        }

        return html;
    }

    private error(error: string): string {
        return `<body>${error}</body>`;
    }

    private addDocument(fileName: string): void {
        if (this.openedDocuments.indexOf(fileName) === -1) {
            this.openedDocuments.push(fileName);
        }
    }

    private removeDocument(fileName: string): void {
        this.openedDocuments = this.openedDocuments.filter((file: string) => file !== fileName);
    }

}
