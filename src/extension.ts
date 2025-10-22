// 文件: src/extension.ts (已集成 CompletionItemProvider 的修改)

// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LanguageClient, LanguageClientOptions, Message, ServerOptions } from 'vscode-languageclient/node';

import LintManager from './linter/LintManager';
import { CtagsManager, ModuleReference } from './ctags';
import * as DocumentSymbolProvider from './providers/DocumentSymbolProvider';
import * as HoverProvider from './providers/HoverProvider';
import * as DefinitionProvider from './providers/DefinitionProvider';
import * as CompletionItemProvider from './providers/CompletionItemProvider';
import { BsvInfoProviderManger } from './BsvProvider';
import * as FormatProvider from './providers/FormatProvider';
import { ExtensionManager } from './extensionManager';
import { createLogger, Logger } from './logger';

import { VerilogTreeDataProvider } from './FileTree/VerilogTreeDataProvider';
import { instantiateModuleInteract } from './commands/ModuleInstantiation';
import { VerilogCodeLensProvider } from './providers/CodeLensProvider';

import { VerilogFormattingProvider } from './formatter/VerilogFormattingProvider';

export var logger: Logger; // Global logger
let ctagsManager: CtagsManager;
let extensionID: string = 'AdolphWang.HDL-Formatter';

let lintManager: LintManager;
let languageClients = new Map<string, LanguageClient>();

export function activate(context: vscode.ExtensionContext) {
  logger = createLogger('Verilog');
  logger.info(extensionID + ' is now active.');

  // ctags 路径检查逻辑
  const ctagsRelativePath = 'resources/ctags/ctags.exe';
  const ctagsBuiltinPath = path.join(context.extensionPath, ctagsRelativePath);
  let ctagsFinalPath: string;
  const userPath = vscode.workspace.getConfiguration('verilog').get<string>('ctags.path');
  if (userPath && userPath.trim() !== '' && userPath.trim() !== 'none') {
      logger.info(`Using user-defined ctags path: ${userPath}`);
      ctagsFinalPath = userPath;
  } else {
      if (fs.existsSync(ctagsBuiltinPath)) {
          logger.info(`Using built-in ctags path: ${ctagsBuiltinPath}`);
          ctagsFinalPath = ctagsBuiltinPath;
      } else {
          vscode.window.showErrorMessage(`Built-in ctags not found at: ${ctagsBuiltinPath}. Please check the extension installation or set a custom path in settings.`);
          logger.error(`Built-in ctags not found at: ${ctagsBuiltinPath}`);
          return;
      }
  }

  ctagsManager = new CtagsManager(logger, context, ctagsFinalPath); 
  ctagsManager.configureAndIndex();
  registerFileTreeView(context, ctagsManager);

  const instantiateCommand = vscode.commands.registerCommand('verilog.instantiateModule', () => {
      instantiateModuleInteract(ctagsManager);
  });

  context.subscriptions.push(instantiateCommand);
  
  let extMgr = new ExtensionManager(context, extensionID, logger.getChild('ExtensionManager'));
  if (extMgr.isVersionUpdated()) {
    extMgr.showChangelogNotification();
  }

  BsvInfoProviderManger.getInstance().onWorkspace(logger);
  vscode.workspace.onDidChangeWorkspaceFolders((_e) => {
    BsvInfoProviderManger.getInstance().onWorkspace(logger);
  });

  // --- Provider 注册区域 ---
  
  // Configure Document Symbol Provider (不变)
  let verilogDocumentSymbolProvider = new DocumentSymbolProvider.VerilogDocumentSymbolProvider(logger.getChild('VerilogDocumentSymbolProvider'), ctagsManager);
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(['verilog', 'systemverilog'], verilogDocumentSymbolProvider));
  
  // ★★★ 1. 修改 Completion Item Provider 的注册逻辑 ★★★
  // =================================================================
  let verilogCompletionItemProvider = new CompletionItemProvider.VerilogCompletionItemProvider(logger.getChild('VerilogCompletionItemProvider'), ctagsManager);
  
  // 为 Verilog 和 SystemVerilog 注册补全，并添加 ` 和 $ 作为触发字符
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ['verilog', 'systemverilog'], 
      verilogCompletionItemProvider, 
      '`', '$' // 新增的触发字符
    )
  );
  
  // 为 VHDL 单独注册补全，它不需要特殊的触发字符
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ['vhdl'], 
      verilogCompletionItemProvider
    )
  );
  // =================================================================


  // Configure Hover Providers (不变)
  let verilogHoverProvider = new HoverProvider.VerilogHoverProvider(logger.getChild('VerilogHoverProvider'), ctagsManager);
  context.subscriptions.push(vscode.languages.registerHoverProvider(['verilog', 'systemverilog'], verilogHoverProvider));
  
  // Configure Definition Providers (不变)
  let verilogDefinitionProvider = new DefinitionProvider.VerilogDefinitionProvider(logger.getChild('VerilogDefinitionProvider'), ctagsManager);
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(['verilog', 'systemverilog'], verilogDefinitionProvider));
  
  // Configure Format Provider (不变)
  let verilogFormatProvider = new FormatProvider.VerilogFormatProvider(logger.getChild('VerilogFormatProvider'));
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'verilog' }, verilogFormatProvider));
  let systemVerilogFormatProvider = new FormatProvider.SystemVerilogFormatProvider(logger.getChild('SystemVerilogFormatProvider'));
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'systemverilog' }, systemVerilogFormatProvider));
  
  // =========================================================================
  // ★★★ 新增开始: 注册你的 AST 格式化器 ★★★
  // =========================================================================
  // 1. 获取你的 parser jar 文件的绝对路径
  const jarRelativePath = path.join('resources', 'verilog-parser-1.0.0-exe.jar');
  const jarAbsolutePath = path.join(context.extensionPath, jarRelativePath);

  if (fs.existsSync(jarAbsolutePath)) {
      logger.info(`Found AST parser at: ${jarAbsolutePath}`);
      // 1. 在插件激活时，只创建一次 Provider 实例
      const astFormattingProvider = new VerilogFormattingProvider(jarAbsolutePath, logger.getChild('VerilogFormattingProvider'));

      // 2. 注册一个ID为 "verilogFormatter.formatActiveFile" 的命令
      let formatCommand = vscode.commands.registerCommand('verilogFormatter.formatActiveFile', async () => {
          const editor = vscode.window.activeTextEditor;

          // 3. 检查当前是否有打开的、符合条件的编辑器
          if (!editor) {
              vscode.window.showInformationMessage('No active editor to format.');
              return;
          }
          const langId = editor.document.languageId;
          if (langId !== 'verilog' && langId !== 'systemverilog') {
              vscode.window.showInformationMessage(`Cannot format a '${langId}' file with this command.`);
              return;
          }

          try {
              // 4. 手动调用 Provider 的核心方法来获取文本编辑操作
              const edits = await astFormattingProvider.provideDocumentFormattingEdits(
                  editor.document,
                  editor.options as vscode.FormattingOptions, // 传递编辑器的格式化选项
                  new vscode.CancellationTokenSource().token
              );

              // 5. 如果成功获取到编辑操作，就应用它们
              if (edits && edits.length > 0) {
                  const workspaceEdit = new vscode.WorkspaceEdit();
                  workspaceEdit.set(editor.document.uri, edits); // 将所有编辑操作放入一个工作区编辑中
                  await vscode.workspace.applyEdit(workspaceEdit); // 原子地应用所有编辑
                  vscode.window.setStatusBarMessage('Formatted with AST Formatter!', 3000); // 显示成功提示
              }
          } catch (e) {
              logger.error('Error executing formatActiveFile command:', e);
              vscode.window.showErrorMessage('An unexpected error occurred during formatting.');
          }
      });

      // 6. 将命令添加到订阅中
      context.subscriptions.push(formatCommand);

  } else {
      const errorMessage = `AST Formatter parser not found at: ${jarAbsolutePath}. The AST-based formatter will be disabled.`;
      vscode.window.showErrorMessage(errorMessage);
      logger.error(errorMessage);
  }
  // =========================================================================
  // ★★★ 新增结束: 注册你的 AST 格式化器 ★★★
  // =========================================================================

  // 注册 CodeLens Provider (不变)
  let verilogCodeLensProvider = new VerilogCodeLensProvider(logger.getChild('VerilogCodeLensProvider'), ctagsManager);
  context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        ['verilog', 'systemverilog'], 
        verilogCodeLensProvider
      )
  );

  // --- 其他语言 (BSV) 的 Provider 注册 (不变) ---
  let bsvDocumentSymbolProvider = new DocumentSymbolProvider.BsvDocumentSymbolProvider(logger.getChild('BsvDocumentSymbolProvider'));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ scheme: 'file', language: 'bsv' }, bsvDocumentSymbolProvider));
  let bsvCompletionItemProvider = new CompletionItemProvider.BsvCompletionItemProvider(logger.getChild('BsvCompletionItemProvider'));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: 'bsv' }, bsvCompletionItemProvider, '.', '(', '='));
  let bsvHoverProvider = new HoverProvider.BsvHoverProvider(logger.getChild('BsvHoverProvider'));
  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file', language: 'bsv' }, bsvHoverProvider));
  let bsvDefinitionProvider = new DefinitionProvider.BsvDefinitionProvider();
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ scheme: 'file', language: 'bsv' }, bsvDefinitionProvider));


  // --- 命令注册区域 (所有内容保持不变) ---

  // Register command for manual linting
  lintManager = new LintManager(logger.getChild('LintManager'));
  vscode.commands.registerCommand('verilog.lint', lintManager.runLintTool, lintManager);

  // 注册 CodeLens 点击后执行的命令
  context.subscriptions.push(
    vscode.commands.registerCommand('verilog.showModuleReferences', async (references: ModuleReference[]) => {
      if (!references || references.length === 0) { return; }
      
      if (references.length === 1) {
        const ref = references[0];
        const doc = await vscode.workspace.openTextDocument(ref.sourcePath);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(ref.position, ref.position),
          preview: true,
        });
      } else {
        const picks = references.map(ref => ({
          label: `↑ ${path.basename(ref.sourcePath)}`,
          description: `line ${ref.position.line + 1}`,
          detail: ref.sourcePath,
          reference: ref
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select a reference to jump to'
        });

        if (selected) {
          const ref = selected.reference;
          const doc = await vscode.workspace.openTextDocument(ref.sourcePath);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(ref.position, ref.position),
            preview: true,
          });
        }
      }
    })
  );

  // Configure language server
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('verilog.languageServer')) {
      return;
    }
    stopAllLanguageClients().finally(() => {
      initAllLanguageClients();
    });
  });
  initAllLanguageClients();

  logger.info(extensionID + ' activation finished.');
}


function setupLanguageClient(
  name: string,
  defaultPath: string,
  serverArgs: string[],
  serverDebugArgs: string[],
  clientOptions: LanguageClientOptions
) {
  let settings = vscode.workspace.getConfiguration('verilog.languageServer.' + name);
  let enabled: boolean = <boolean>settings.get('enabled', false);

  let binPath = <string>settings.get('path', defaultPath);
  let customArgs = <string>settings.get('arguments');

  if (customArgs) {
    serverArgs.push(customArgs);
    serverDebugArgs.push(customArgs);
  }

  let serverOptions: ServerOptions = {
    run: { command: binPath, args: serverArgs },
    debug: { command: binPath, args: serverDebugArgs },
  };

  languageClients.set(
    name,
    new LanguageClient(name, name + ' language server', serverOptions, clientOptions)
  );
  if (!enabled) {
    return;
  }
  languageClients.get(name).start();
  logger.info('"' + name + '" language server started.');
}

function initAllLanguageClients() {
  // init svls
  setupLanguageClient('svls', 'svls', [], ['--debug'], {
    documentSelector: [{ scheme: 'file', language: 'systemverilog' }],
  });

  // init veridian
  setupLanguageClient('veridian', 'veridian', [], [], {
    documentSelector: [{ scheme: 'file', language: 'systemverilog' }],
  });

  // init hdlChecker
  setupLanguageClient('hdlChecker', 'hdl_checker', ['--lsp'], ['--lsp'], {
    documentSelector: [
      { scheme: 'file', language: 'verilog' },
      { scheme: 'file', language: 'systemverilog' },
      { scheme: 'file', language: 'vhdl' },
    ],
  });

  // init verible-verilog-ls
  setupLanguageClient('veribleVerilogLs', 'verible-verilog-ls', [], [], {
    connectionOptions: {
      messageStrategy: {
        handleMessage: (message, next) => {
          if (Message.isResponse(message) && message.result['capabilities']) {
            delete message.result['capabilities']['diagnosticProvider'];
            delete message.result['capabilities']['documentFormattingProvider'];
            delete message.result['capabilities']['documentRangeFormattingProvider'];
          }
          next(message);
        },
      },
    },
    documentSelector: [
      { scheme: 'file', language: 'verilog' },
      { scheme: 'file', language: 'systemverilog' },
    ],
  });

  // init rustHdl
  setupLanguageClient('rustHdl', 'vhdl_ls', [], [], {
    documentSelector: [{ scheme: 'file', language: 'vhdl' }],
  });
}

function stopAllLanguageClients(): Promise<any> {
  var p = [];
  for (const [name, client] of languageClients) {
    if (client.isRunning()) {
      p.push(client.stop());
      logger.info('"' + name + '" language server stopped.');
    }
  }
  return Promise.all(p);
}

//注册文件树视图
function registerFileTreeView(context: vscode.ExtensionContext, ctags: CtagsManager) { // <-- 接收 ctags 实例
    // 使用推荐的 API 获取工作区路径，并处理多工作区或无工作区的情况
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!workspaceRoot) {
        logger.warn('No workspace folder open.');
        return;
    }

    const verilogTreeDataProvider = new VerilogTreeDataProvider(workspaceRoot, ctags, context); // <-- 注入依赖
    context.subscriptions.push(vscode.window.registerTreeDataProvider('verilogFileTree', verilogTreeDataProvider));
    context.subscriptions.push(vscode.commands.registerCommand('verilogFileTree.refresh', () => verilogTreeDataProvider.refresh()));

    context.subscriptions.push(vscode.commands.registerCommand('verilogTree.openContainingFolder', (node: any) => {

        let filePath: string | undefined;

        if (node && node.symbol && typeof node.symbol.path === 'string') {
            filePath = node.symbol.path;
        }
        else if (node && node.resourceUri && node.resourceUri.scheme === 'file') {
            filePath = node.resourceUri.fsPath; 
        }
        else if (node && typeof node.path === 'string') {
            filePath = node.path;
        }
        if (filePath) {
            try {
                const fileUri = vscode.Uri.file(filePath);
                vscode.commands.executeCommand('revealFileInOS', fileUri);
            } catch (e) {
                console.error(`尝试使用路径 "${filePath}" 创建 Uri 或执行命令时出错:`, e);
                vscode.window.showErrorMessage('无法处理找到的文件路径。');
            }
        } else {
            console.error('失败! 节点对象中没有找到任何有效的路径属性。');
            vscode.window.showErrorMessage('无法从此节点获取文件路径，请检查调试控制台。');
        }
    }));

    vscode.commands.executeCommand('verilogFileTree.refresh');
    console.log('HDL File Tree 已注册');
}

export function deactivate(): Promise<void> {
  logger.info('Deactivated');
  return stopAllLanguageClients();
}
