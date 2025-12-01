// 文件: src/providers/HoverProvider.ts (请确认您的项目中使用的是此版本)

import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, Symbol } from '../ctags';
import { Logger } from '../logger';

export class VerilogHoverProvider implements vscode.HoverProvider {
    private logger: Logger;
    private ctagsManager: CtagsManager;

    constructor(logger: Logger, ctagsManager: CtagsManager) {
        this.logger = logger;
        this.ctagsManager = ctagsManager;
    }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        await this.ctagsManager.waitForIndex();

        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return undefined;
        }
        const word = document.getText(range);

        // 步骤 1: 检查光标是否悬浮在当前文件的一个符号“定义”上
        const allSymbolsInDoc: Symbol[] = await this.ctagsManager.getSymbols(document);
        const symbolOnDefinition = allSymbolsInDoc.find(s => s.name === word && s.startPosition.line === range.start.line);

        if (symbolOnDefinition) {
            this.logger.info(`[HoverProvider] Hover on a definition: "${symbolOnDefinition.name}" (Type: ${symbolOnDefinition.type})`);

            // Case 1.1: 悬浮在模块/实体定义上 -> 显示所有实例化列表
            if (symbolOnDefinition.type === 'module' || symbolOnDefinition.type === 'entity') {
                const references = this.ctagsManager.getReferencesForModule(symbolOnDefinition.name);
                if (references && references.length > 0) {
                    const hoverContent = new vscode.MarkdownString('', true);
                    hoverContent.isTrusted = true;
                    const titlePrefix = (symbolOnDefinition.type === 'entity') ? 'Entity' : 'Module';
                    const title = `### **${titlePrefix} \`${symbolOnDefinition.name}\` is instantiated ${references.length} time(s):**`;
                    hoverContent.appendMarkdown(title + '\n---\n');
                    references.forEach(ref => {
                        const uri = vscode.Uri.file(ref.sourcePath);
                        const line = ref.position.line + 1;
                        const fileName = path.basename(ref.sourcePath);
                        const args = [uri, { selection: new vscode.Range(ref.position, ref.position) }];
                        const commandUri = vscode.Uri.parse(`command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`);
                        hoverContent.appendMarkdown(`- [${fileName}:${line}](${commandUri})\n`);
                    });
                    return new vscode.Hover(hoverContent, range);
                } else {
                    const titlePrefix = (symbolOnDefinition.type === 'entity') ? 'Entity' : 'Module';
                    const message = `### **${titlePrefix} \`${symbolOnDefinition.name}\` is defined but not instantiated.**`;
                    return new vscode.Hover(new vscode.MarkdownString(message), range);
                }
            }
            // Case 1.2: 悬浮在其他符号（信号、参数等）的定义上 -> 显示其声明
            else if (symbolOnDefinition.pattern) {
                const declaration = symbolOnDefinition.pattern.replace(/^\^/, '').replace(/\$$/, '').trim();
                const hoverContent = new vscode.MarkdownString();
                hoverContent.appendCodeblock(declaration, document.languageId);
                hoverContent.appendMarkdown(`\n*(${symbolOnDefinition.type})*`);
                return new vscode.Hover(hoverContent, range);
            }
        }

        // 步骤 2: 如果不在定义上，则检查光标是否悬浮在一个模块/实体的“实例化”上
        this.logger.info(`[HoverProvider] Not on a definition. Searching globally for module/entity definition of "${word}"`);
        const workspaceSymbols = this.ctagsManager.getWorkspaceSymbols();
        for (const symbolsInFile of workspaceSymbols.values()) {
            const definitionSymbol = symbolsInFile.find(s => 
                s.name.toLowerCase() === word.toLowerCase() && 
                (s.type === 'module' || s.type === 'entity')
            );
            
            if (definitionSymbol) {
                this.logger.info(`[HoverProvider] Found global definition for "${word}" in ${definitionSymbol.path}`);
                const hoverContent = new vscode.MarkdownString('', true);
                hoverContent.isTrusted = true;

                const titlePrefix = (definitionSymbol.type === 'entity') ? 'Entity' : 'Module';
                hoverContent.appendMarkdown(`### ${titlePrefix}: \`${definitionSymbol.name}\`\n`);

                const declaration = definitionSymbol.pattern.replace(/^\^/, '').replace(/\$$/, '').trim();
                hoverContent.appendCodeblock(declaration, document.languageId);

                const uri = vscode.Uri.file(definitionSymbol.path);
                const line = definitionSymbol.startPosition.line + 1;
                const fileName = path.basename(definitionSymbol.path);
                const args = [uri, { selection: new vscode.Range(definitionSymbol.startPosition, definitionSymbol.startPosition) }];
                const commandUri = vscode.Uri.parse(`command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`);
                hoverContent.appendMarkdown(`\n---\nDefined in: [${fileName}:${line}](${commandUri})`);
                
                return new vscode.Hover(hoverContent, range);
            }
        }
        
        this.logger.info(`[HoverProvider] No symbol or definition found for "${word}"`);
        return undefined;
    }
}

// BsvHoverProvider 保持不变
export class BsvHoverProvider implements vscode.HoverProvider {
    private logger: Logger;
    constructor(logger: Logger) { this.logger = logger; }
    public async provideHover(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        return undefined;
    }
}
