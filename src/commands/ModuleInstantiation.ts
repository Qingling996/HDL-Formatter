// 文件: src/commands/ModuleInstantiation.ts

// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// ★ 1. 修改导入，引入 CtagsManager 和 Symbol
import { CtagsManager, Symbol } from '../ctags'; 
// logger 从外部传入，不再自己引用
// import { logger } from '../extension';

// ★ 2. 修改函数签名，接收 ctagsManager 实例
export function instantiateModuleInteract(ctagsManager: CtagsManager) {
  let filePath = path.dirname(vscode.window.activeTextEditor.document.fileName);
  selectFile(filePath).then((srcpath) => {
    if (!srcpath) return;
    // ★ 3. 将 ctagsManager 传递下去
    instantiateModule(srcpath, ctagsManager).then((inst) => {
      if (inst) {
        vscode.window.activeTextEditor.insertSnippet(inst);
      }
    });
  });
}

// ★ 4. 修改函数签名，接收 ctagsManager 实例
async function instantiateModule(srcpath: string, ctagsManager: CtagsManager): Promise<vscode.SnippetString | undefined> {
    let moduleName: string;
    
    // ★ 5. 核心修改：使用新的 getSymbolsFromFile 方法，移除所有旧代码
    console.log(`Getting symbols from: ${srcpath}`);
    const allSymbols = await ctagsManager.getSymbolsFromFile(srcpath);

    if (!allSymbols || allSymbols.length === 0) {
        vscode.window.showWarningMessage('No symbols found in the selected file.');
        return undefined;
    }

    let module: Symbol;
    const modules: Symbol[] = allSymbols.filter((tag) => tag.type === 'module');
    
    // No modules found
    if (modules.length === 0) {
      vscode.window.showErrorMessage('Verilog-HDL/SystemVerilog: No modules found in the file');
      return undefined;
    }
    // Only one module found
    else if (modules.length === 1) {
      module = modules[0];
    }
    // many modules found
    else {
      moduleName = await vscode.window.showQuickPick(
        modules.map((tag) => tag.name),
        { placeHolder: 'Choose a module to instantiate' }
      );
      if (moduleName === undefined) return undefined;
      module = modules.find((tag) => tag.name === moduleName);
      if (!module) return undefined;
    }

    const scope = module.parentScope ? `${module.parentScope}.${module.name}` : module.name;
    
    const ports: Symbol[] = allSymbols.filter(
      (tag) => tag.type === 'port' && tag.parentType === 'module' && tag.parentScope === scope
    );
    const portsName = ports.map((tag) => tag.name);

    const params: Symbol[] = allSymbols.filter(
      (tag) => tag.type === 'parameter' && tag.parentType === 'module' && tag.parentScope === scope
    );
    const parametersName = params.map((tag) => tag.name);

    let paramString = ``;
    if (parametersName.length > 0) {
      paramString = `\n#(\n${instantiatePort(parametersName)})\n`;
    }
    
    return new vscode.SnippetString()
        .appendText(module.name + ' ')
        .appendText(paramString)
        .appendPlaceholder('u_')
        .appendPlaceholder(`${module.name}(\n`)
        .appendText(instantiatePort(portsName))
        .appendText(');\n');
}


// ★ 6. 移除自定义的 ModuleTags 类，它不再被需要 ★
// class ModuleTags extends Ctags { ... }


// (后面的辅助函数 getIndentationString, instantiatePort, selectFile, getDirectories, getFiles 保持不变)
function getIndentationString(): string {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const useSpaces = editorConfig.get<boolean>('insertSpaces', true);
  const tabSize = editorConfig.get<number>('tabSize', 4);
  return useSpaces ? ' '.repeat(tabSize) : '\t';
}

function instantiatePort(ports: string[]): string {
  let port = '';
  let maxLen = 0;
  const indent = getIndentationString();
  ports.forEach(p => { if (p.length > maxLen) maxLen = p.length; });

  for (let i = 0; i < ports.length; i++) {
    let element = ports[i];
    let padding = ' '.repeat(maxLen - element.length);
    port += `${indent}.${element}${padding} (${element})`;
    if (i !== ports.length - 1) {
      port += ',';
    }
    port += '\n';
  }
  return port;
}

async function selectFile(currentDir?: string): Promise<string | undefined> {
  currentDir = currentDir || vscode.workspace.rootPath;
  let dirs = getDirectories(currentDir);
  if (currentDir !== vscode.workspace.rootPath) {
    dirs.unshift('..');
  }
  let files = getFiles(currentDir).filter((file) => file.endsWith('.v') || file.endsWith('.sv'));
  let items: vscode.QuickPickItem[] = [];
  dirs.forEach((dir) => items.push({ label: dir, description: 'folder' }));
  files.forEach((file) => items.push({ label: file }));
  let selected = await vscode.window.showQuickPick(items, { placeHolder: 'Choose the module file' });
  if (!selected) return undefined;
  let location = path.join(currentDir, selected.label);
  if (fs.statSync(location).isDirectory()) {
    return selectFile(location);
  }
  return location;
}

function getDirectories(srcpath: string): string[] {
  return fs.readdirSync(srcpath).filter((file) => fs.statSync(path.join(srcpath, file)).isDirectory());
}

function getFiles(srcpath: string): string[] {
  return fs.readdirSync(srcpath).filter((file) => fs.statSync(path.join(srcpath, file)).isFile());
}
