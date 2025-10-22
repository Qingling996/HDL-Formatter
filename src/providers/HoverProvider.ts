// 文件: src/providers/HoverProvider.ts (最终增强版 - 美化模块悬浮提示)

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

        const allSymbolsInDoc: Symbol[] = await this.ctagsManager.getSymbols(document);
        
        const symbol = allSymbolsInDoc.find(s => s.name === word && s.startPosition.line === range.start.line);

        if (!symbol) {
            this.logger.warn(`[VerilogHoverProvider] No symbol definition found for "${word}" on line ${range.start.line + 1}.`);
            return undefined;
        }

        // Case 1: 如果符号是模块 (module) 或实体 (entity)，则显示它的所有引用/实例化位置
        if (symbol.type === 'module' || symbol.type === 'entity') {
            const references = this.ctagsManager.getReferencesForModule(symbol.name);

            if (references && references.length > 0) {
                this.logger.info(`[VerilogHoverProvider] Found ${references.length} references for module "${symbol.name}"`);

                // ★★★ 核心修改：使用 MarkdownString 并应用标题和加粗格式 ★★★
                const hoverContent = new vscode.MarkdownString('', true); 
                hoverContent.isTrusted = true; // 允许命令链接

                // 使用三级标题 ### 实现“放大”效果，并用 **...** 加粗
                const title = `### **Module \`${symbol.name}\` is instantiated ${references.length} time(s):**`;
                hoverContent.appendMarkdown(title);
                hoverContent.appendMarkdown('\n---\n'); // 添加一条美观的分割线

                references.forEach(ref => {
                    const uri = vscode.Uri.file(ref.sourcePath);
                    const line = ref.position.line + 1;
                    const fileName = path.basename(ref.sourcePath);

                    const args = [uri, { selection: new vscode.Range(ref.position, ref.position) }];
                    const commandUri = vscode.Uri.parse(`command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`);

                    // 列表项保持不变，但整体会在加粗放大的标题下，显得更清晰
                    hoverContent.appendMarkdown(`- [${fileName}:${line}](${commandUri})\n`);
                });

                return new vscode.Hover(hoverContent, range);
            } else {
                // ★★★ 核心修改：对未实例化的提示也应用相同格式 ★★★
                const message = `### **Module \`${symbol.name}\` is defined but not instantiated.**`;
                const hoverContent = new vscode.MarkdownString(message);
                return new vscode.Hover(hoverContent, range);
            }
        } 

        // Case 2: 对于所有其他类型的符号 (parameter, wire, reg 等)，显示其自身的定义
        else {
            if (symbol.pattern) {
                const declaration = symbol.pattern.replace(/^\^/, '').replace(/\$$/, '').trim();
                this.logger.info(`[VerilogHoverProvider] Showing definition for "${word}"`);

                const hoverContent = new vscode.MarkdownString();
                hoverContent.appendCodeblock(declaration, document.languageId);
                hoverContent.appendMarkdown(`\n*(${symbol.type})*`);

                return new vscode.Hover(hoverContent, range);
            }
        }

        return undefined;
    }
}

// BsvHoverProvider: 保持不变
export class BsvHoverProvider implements vscode.HoverProvider {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    public async provideHover(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        this.logger.info('[BsvHoverProvider] Hover requested');
        return undefined;
    }
}
