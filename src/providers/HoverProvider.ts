// 文件: src/providers/HoverProvider.ts (最终版 - 统一数据源)

import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, Symbol, ModuleReference } from '../ctags';
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

        const allSymbolsInDoc: Symbol[] = await this.ctagsManager.getSymbols(document);
        
        // 查找光标下的符号定义
        const symbol = allSymbolsInDoc.find(s => s.name === word && s.startPosition.line === range.start.line);

        if (!symbol) {
            return undefined;
        }

        this.logger.info(`[HoverProvider] Found symbol for hover: "${symbol.name}" (Type: ${symbol.type}) at line ${symbol.startPosition.line + 1}`);

        // Case 1: 符号是模块 (module) 或实体 (entity) 的定义
        if (symbol.type === 'module' || symbol.type === 'entity') {
            
            // ★★★★★★★★★★★★★★★★★ 核心修复：统一调用 CtagsManager ★★★★★★★★★★★★★★★★★
            // 不再区分 Verilog 和 VHDL，直接从 CtagsManager 获取已建立的引用信息
            const references = this.ctagsManager.getReferencesForModule(symbol.name);

            if (references && references.length > 0) {
                this.logger.info(`[HoverProvider] Found ${references.length} references for "${symbol.name}"`);

                const hoverContent = new vscode.MarkdownString('', true); 
                hoverContent.isTrusted = true;

                const titlePrefix = (symbol.type === 'entity') ? 'Entity' : 'Module';
                const title = `### **${titlePrefix} \`${symbol.name}\` is instantiated ${references.length} time(s):**`;
                hoverContent.appendMarkdown(title);
                hoverContent.appendMarkdown('\n---\n');

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
                const titlePrefix = (symbol.type === 'entity') ? 'Entity' : 'Module';
                const message = `### **${titlePrefix} \`${symbol.name}\` is defined but not instantiated.**`;
                const hoverContent = new vscode.MarkdownString(message);
                return new vscode.Hover(hoverContent, range);
            }
        } 

        // Case 2: 其他类型的符号 (parameter, wire, reg etc.)
        else {
            if (symbol.pattern) {
                const declaration = symbol.pattern.replace(/^\^/, '').replace(/\$$/, '').trim();
                const hoverContent = new vscode.MarkdownString();
                hoverContent.appendCodeblock(declaration, document.languageId);
                hoverContent.appendMarkdown(`\n*(${symbol.type})*`);
                return new vscode.Hover(hoverContent, range);
            }
        }

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
