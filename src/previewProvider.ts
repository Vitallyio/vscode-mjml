"use strict";

import * as vscode from "vscode";

import helper from "./helper";

export default class PreviewManager {

    private IDMap: IDMap = new IDMap();
    private fileMap: Map<string, MJMLView> = new Map<string, MJMLView>();
    private subscriptions: vscode.Disposable[];

    constructor(context: vscode.ExtensionContext) {
        this.subscriptions = context.subscriptions;

        this.subscriptions.push(
            vscode.commands.registerCommand("mjml.previewToSide", () => {
                this.previewCommand();
            })
        );
    }

    private previewCommand(): void {
        let documentURI: string = this.IDMap.createDocumentUri(vscode.window.activeTextEditor.document.uri);
        let mjmlPreview: MJMLView;

        if (!this.IDMap.hasUri(documentURI)) {
            mjmlPreview = new MJMLView(this.subscriptions, vscode.window.activeTextEditor.document);
            this.fileMap.set(this.IDMap.add(documentURI, mjmlPreview.uri), mjmlPreview);
        }
        else {
            mjmlPreview = this.fileMap.get(this.IDMap.getByUri(documentURI));
        }

        mjmlPreview.execute();
    }

    public dispose(): void {
        let values: IterableIterator<MJMLView> = this.fileMap.values();
        let value: IteratorResult<MJMLView> = values.next();

        while (!value.done) {
            value.value.dispose();
            value = values.next();
        }
    }

}

class MJMLView {

    private registrations: vscode.Disposable[] = [];
    private document: vscode.TextDocument;
    private provider: PreviewContentProvider;
    private previewUri: vscode.Uri;
    private viewColumn: vscode.ViewColumn;
    private label: string;

    constructor(subscriptions: vscode.Disposable[], document: vscode.TextDocument) {
        this.document = document;
        this.provider = new PreviewContentProvider(this.document);

        this.previewUri = this.createUri(document.uri);
        this.viewColumn = vscode.ViewColumn.Two;

        this.label = "MJML Preview";

        this.registrations.push(vscode.workspace.registerTextDocumentContentProvider("mjml-preview", this.provider));
        this.registerEvents(subscriptions);
    }

    private registerEvents(subscriptions: vscode.Disposable[]): void {
        subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                if (helper.isMJMLFile(document)) {
                    this.provider.update(this.previewUri);
                }
            }),

            vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
                if (vscode.workspace.getConfiguration("mjml").updateWhenTyping) {
                    if (helper.isMJMLFile(event.document)) {
                        this.provider.update(this.previewUri);
                    }
                }
            }),

            vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor) => {
                if (this.document.uri === editor.document.uri) {
                    if (helper.isMJMLFile(editor.document)) {
                        this.provider.update(this.previewUri);
                    }
                }
            })
        );
    }

    public dispose(): void {
        for (let i in this.registrations) {
            this.registrations[i].dispose();
        }
    }

    public execute(): void {
        vscode.commands.executeCommand("vscode.previewHtml", this.previewUri, this.viewColumn, this.label).then((success: boolean) => {
            if (this.viewColumn === 2) {
                if (vscode.workspace.getConfiguration("mjml").preserveFocus) {
                    // Preserve focus of Text Editor after preview open
                    vscode.window.showTextDocument(this.document);
                }
            }
        }, (reason: string) => {
            vscode.window.showErrorMessage(reason);
        });
    }

    public get uri(): vscode.Uri {
        return this.previewUri;
    }

    private createUri(uri: vscode.Uri): vscode.Uri {
        return vscode.Uri.parse("mjml-preview://authority/mjml-preview/sidebyside/");
    }

}

class PreviewContentProvider implements vscode.TextDocumentContentProvider {

    private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
    private document: vscode.TextDocument;
    private _dataFileName: string;

    constructor(document: vscode.TextDocument) {
        this.document = document;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri): void {
        if (/mjml-preview/.test(uri.fsPath) && /sidebyside/.test(uri.fsPath)) {
            if (vscode.window.activeTextEditor.document.fileName == this.document.fileName) {
                this._onDidChange.fire(uri);
            }
        }
    }

    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        if (this.document.languageId !== "mjml") {
            return Promise.resolve(this.error("Active editor doesn't show a MJML document."));
        }

        const mjml = await this.renderMJML();
        return mjml;
    }

    private async renderMJML(): Promise<string> {
        let html: string;

        try {
            html = await helper.compileHtml(this.document.getText());
        } catch (err) {
            return this.error(err.toString());
        }

        html = helper.mjml2html(html, false, false);

        if (html) {
            return helper.fixLinks(html);
        }

        return this.error("Active editor doesn't show a MJML document.");
    }

    private error(error: string): string {
        return `<body>${error}</body>`;
    }

}

class IDMap {

    private map: Map<[string, vscode.Uri], string> = new Map<[string, vscode.Uri], string>();

    private UUIDv4(): string {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string) => {
            let r: number = Math.random() * 16 | 0, v: number = c == "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    public createDocumentUri(uri: vscode.Uri): string {
        return JSON.stringify({ uri: uri });
    }

    public getByUri(uri: string): string | undefined {
        let keys: IterableIterator<[string, vscode.Uri]> = this.map.keys();
        let key: IteratorResult<[string, vscode.Uri]> = keys.next();

        while (!key.done) {
            if (key.value.indexOf(uri) > -1) {
                return this.map.get(key.value);
            }

            key = keys.next();
        }

        return undefined;
    }

    public hasUri(uri: string): boolean {
        return this.getByUri(uri) != undefined;
    }

    public add(documentUri: string, previewUri: vscode.Uri): string {
        let id: string = this.UUIDv4();
        this.map.set([documentUri, previewUri], id);

        return id;
    }

}
