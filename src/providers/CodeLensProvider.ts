//模块声明位置的悬浮显示
import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, ModuleReference, Symbol } from '../ctags'; // 导入 Symbol 以便在循环中使用
import { Logger } from '../logger';

export class VerilogCodeLensProvider implements vscode.CodeLensProvider {
private logger: Logger;
private ctagsManager: CtagsManager;

constructor(logger: Logger, ctagsManager: CtagsManager) {
this.logger = logger;
this.ctagsManager = ctagsManager;
}

async provideCodeLenses(
document: vscode.TextDocument,
_token: vscode.CancellationToken
): Promise<vscode.CodeLens[]> {
// 从配置中读取功能开关，允许用户禁用此功能 (保持不变)
if (
!vscode.workspace
.getConfiguration('verilog')
.get<boolean>('codelens.references.enabled', true)
) {
return [];
}

// 等待索引完成，确保数据是最新的
await this.ctagsManager.waitForIndex();
this.logger.info(`[CodeLensProvider] Providing CodeLenses for ${document.uri.fsPath}`);

const lenses: vscode.CodeLens[] = [];
const symbols = await this.ctagsManager.getSymbols(document);

for (const symbol of symbols) {

// ★★★★★★★★★★★★★★★★★★★★★★★ 核心修复 ★★★★★★★★★★★★★★★★★★★★★★★
// 将判断条件从仅'module'扩展为'module'或'entity'，以同时支持VHDL和Verilog
if (symbol.type === 'module' || symbol.type === 'entity') {
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

const references = this.ctagsManager.getReferencesForModule(symbol.name);

if (references.length > 0) {
// 使用您自定义的标题格式化函数 (保持不变)
const title = this.formatTitle(references);

// 使用您自定义的命令 (保持不变)
const command: vscode.Command = {
title: title,
command: 'verilog.showModuleReferences', 
arguments: [references], 
};

// 将 CodeLens 放置在 module 或 entity 声明行的上方 (保持不变)
const range = new vscode.Range(symbol.startPosition, symbol.startPosition);
lenses.push(new vscode.CodeLens(range, command));
this.logger.info(`[CodeLensProvider] Found ${references.length} references for "${symbol.name}"`);
}
}
}
return lenses;
}

// 您的自定义标题格式化函数，无需任何改动
private formatTitle(references: ModuleReference[]): string {
const uniqueFilePaths = [...new Set(references.map((ref) => ref.sourcePath))];
const fileNames = uniqueFilePaths.map((filePath) => `↑ ${path.basename(filePath)}`);
return fileNames.join(' | ');
}
}
