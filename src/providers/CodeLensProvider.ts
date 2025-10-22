// 文件: src/providers/CodeLensProvider.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, ModuleReference } from '../ctags'; // 导入 CtagsManager 和我们定义的 ModuleReference 接口
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
    // 从配置中读取功能开关，允许用户禁用此功能
    if (
      !vscode.workspace
        .getConfiguration('verilog')
        .get<boolean>('codelens.references.enabled', true)
    ) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const symbols = await this.ctagsManager.getSymbols(document);

    for (const symbol of symbols) {
      // 我们只关心模块定义
      if (symbol.type === 'module') {
        const references = this.ctagsManager.getReferencesForModule(symbol.name);
        if (references.length > 0) {
          const title = this.formatTitle(references);
          const command: vscode.Command = {
            title: title,
            command: 'verilog.showModuleReferences', // 点击后要执行的命令
            arguments: [references], // 将引用信息作为参数传给命令
          };
          // 将 CodeLens 放置在 module 声明行的上方
          const range = new vscode.Range(symbol.startPosition, symbol.startPosition);
          lenses.push(new vscode.CodeLens(range, command));
        }
      }
    }
    return lenses;
  }

  private formatTitle(references: ModuleReference[]): string {
    // 使用 Set 去重，避免同一个文件多次实例化时显示多次文件名
    const uniqueFilePaths = [...new Set(references.map((ref) => ref.sourcePath))];
    const fileNames = uniqueFilePaths.map((filePath) => `↑ ${path.basename(filePath)}`);
    return fileNames.join(' | ');
  }
}
