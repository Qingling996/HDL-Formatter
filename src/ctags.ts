// 文件: src/ctags.ts (第1步修改版 - 添加结束行号解析)

// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { exec as execNonPromise } from 'child_process';
import * as util from 'util';
import { Logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';

const exec = util.promisify(execNonPromise);

export interface ModuleReference {
  sourcePath: string;
  position: vscode.Position;
}

export class Symbol {
  name: string;
  type: string;
  pattern: string;
  startPosition: vscode.Position;
  endPosition?: vscode.Position;
  parentScope: string;
  parentType: string;
  isValid: boolean;
  path: string;
  typeRef?: string;
  scope?: string; 
  constructor(
    name: string,
    type: string,
    pattern: string,
    startLine: number,
    parentScope: string,
    parentType: string,
    path: string,
    endLine?: number, // 这个参数保持不变，但我们会通过解析直接给值
    isValid?: boolean,
    typeRef?: string
  ) {
    this.name = name;
    this.type = type;
    this.pattern = pattern;
    this.startPosition = new vscode.Position(startLine, 0);
    this.parentScope = parentScope;
    this.parentType = parentType;
    this.path = path;
    this.isValid = isValid ?? false;
    this.typeRef = typeRef;
    // ★★★ 构造函数修改 ★★★
    // 如果 endLine 有效，就用它；否则，先默认为 startLine。
    // 之后 calculateEndPositions 会覆盖这个值。
    this.endPosition = new vscode.Position(endLine ?? startLine, Number.MAX_VALUE);
  }

  setEndPosition(endLine: number) {
    this.endPosition = new vscode.Position(endLine, Number.MAX_VALUE);
    this.isValid = true;
  }

  getDocumentSymbol(): vscode.DocumentSymbol {
    let range = new vscode.Range(this.startPosition, this.endPosition);
    return new vscode.DocumentSymbol(this.name, this.type, Symbol.getSymbolKind(this.type), range, range);
  }

  static isContainer(type: string): boolean {
    switch (type) {
      case 'function': case 'module': case 'task': case 'block': case 'class': case 'covergroup': case 'enum': case 'interface': case 'package': case 'program': case 'struct': return true;
      case 'entity': case 'architecture': case 'process': case 'package_body': return true;
      case 'constant': case 'parameter': case 'event': case 'net': case 'port': case 'register': case 'modport': case 'prototype': case 'typedef': case 'property': case 'assert': return false;
      case 'signal': case 'variable': case 'literal': return false;
    }
    return false;
  }

  static getSymbolKind(name: String): vscode.SymbolKind {
    switch (name) {
      case 'constant': return vscode.SymbolKind.Constant; case 'parameter': return vscode.SymbolKind.Constant; case 'event': return vscode.SymbolKind.Event; case 'function': return vscode.SymbolKind.Function; case 'module': return vscode.SymbolKind.Module; case 'net': return vscode.SymbolKind.Variable; case 'port': return vscode.SymbolKind.Boolean; case 'register': return vscode.SymbolKind.Variable; case 'task': return vscode.SymbolKind.Function; case 'block': return vscode.SymbolKind.Module; case 'assert': return vscode.SymbolKind.Variable; case 'class': return vscode.SymbolKind.Class; case 'covergroup': return vscode.SymbolKind.Class; case 'enum': return vscode.SymbolKind.Enum; case 'interface': return vscode.SymbolKind.Interface; case 'modport': return vscode.SymbolKind.Boolean; case 'package': return vscode.SymbolKind.Package; case 'program': return vscode.SymbolKind.Module; case 'prototype': return vscode.SymbolKind.Function; case 'property': return vscode.SymbolKind.Property; case 'struct': return vscode.SymbolKind.Struct; case 'typedef': return vscode.SymbolKind.TypeParameter;
      case 'entity': return vscode.SymbolKind.Class; case 'architecture': return vscode.SymbolKind.Module; case 'process': return vscode.SymbolKind.Function; case 'signal': return vscode.SymbolKind.Variable; case 'variable': return vscode.SymbolKind.Variable; case 'literal': return vscode.SymbolKind.EnumMember; case 'package_body': return vscode.SymbolKind.Package;
      default: return vscode.SymbolKind.Variable;
    }
  }
}

export class CtagsParser {
  private logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ★★★ parseTagLine 方法修改 ★★★
  public parseTagLine(line: string, filePath: string): Symbol | undefined {
    try {
      let name, type, pattern, lineNoStr, parentScope, parentType: string;
      let typeRef: string | undefined;
      let endLine: number | undefined; // <--- 新增变量
      let scope: string[];
      let lineNo: number;
      let parts: string[] = line.split('\t');
      if (parts.length < 4) return undefined;

      name = parts[0];
      pattern = parts[1]; // pattern 是第2个
      lineNoStr = parts[2]; // line number 是第3个
      lineNo = Number(lineNoStr.slice(0, -2)) - 1;

      // 从第4个部分开始查找字段
      type = 'unknown'; // 默认值
      parentScope = '';
      parentType = '';
      
      for (let i = 3; i < parts.length; i++) {
        const part = parts[i];
        if (i === 3) { // 第4个部分通常是 kind/type
            type = part;
            continue;
        }

        if (part.startsWith('typeref:')) {
          typeRef = part.substring('typeref:'.length).replace('struct ', '');
        } else if (part.startsWith('end:')) { // <--- 解析 end 字段
          endLine = parseInt(part.substring('end:'.length), 10) - 1;
        } else if (part.includes(':') && !part.startsWith('line:')) { // 作用域信息
          scope = part.split(':');
          parentType = scope[0];
          parentScope = scope[1];
        }
      }
      
      if (parts.length == 6 && parts[5] === 'parameter:') {
        type = 'parameter';
      }

      // 注意构造函数的参数顺序
      return new Symbol(name, type, pattern, lineNo, parentScope, parentType, filePath, endLine, undefined, typeRef);
    } catch (e) {
      this.logger.error('Line Parser: ' + e);
      this.logger.error('Line: ' + line);
      return undefined;
    }
  }
}

export class CtagsManager {
  private logger: Logger;
  private context: vscode.ExtensionContext;
  private ctagsParser: CtagsParser;
  private ctagsPath: string;
  private fileSymbols: Map<string, Symbol[]> = new Map();
  private referencesMap: Map<string, ModuleReference[]> = new Map();
  private indexingPromise: Promise<void> | null = null;

  constructor(logger: Logger, context: vscode.ExtensionContext, ctagsPath: string) {
    this.logger = logger;
    this.context = context;
    this.ctagsPath = ctagsPath;
    this.ctagsParser = new CtagsParser(this.logger);
    this.logger.info('CtagsManager Inited');
  }

  public async waitForIndex(): Promise<void> {
    if (this.indexingPromise) {
      await this.indexingPromise;
    }
  }

  public getWorkspaceSymbols(): Map<string, Symbol[]> {
    return this.fileSymbols;
  }

  public getReferencesForModule(moduleName: string): ModuleReference[] {
    return this.referencesMap.get(moduleName) || [];
  }

  public async findSymbol(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DefinitionLink[]> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      return [];
    }
    const word = document.getText(range);
    const keywords = new Set(['module', 'endmodule', 'begin', 'end', 'if', 'else', 'always', 'initial', 'assign', 'entity', 'architecture', 'process']);
    if (keywords.has(word)) {
      return [];
    }

    const validSymbolTypes = [
        'module', 'interface', 'program', 'package', 'class',
        'port', 'net', 'register', 'logic', 'wire', 'reg', 'integer', 'real', 'time',
        'parameter', 'localparam', 'constant', 
        'function', 'task', 'typedef', 'enum', 'struct', 'instance',
        'entity', 'architecture', 'signal', 'variable', 'port', 'constant', 'process',
        'package_body', 'literal'
    ];

    for (const symbolsInFile of this.fileSymbols.values()) {
      for (const symbol of symbolsInFile) {
        if (symbol.name === word && validSymbolTypes.includes(symbol.type)) {
          const targetUri = vscode.Uri.file(symbol.path);
          const targetRange = new vscode.Range(symbol.startPosition, symbol.startPosition);
          return [{
            originSelectionRange: range,
            targetUri: targetUri,
            targetRange: targetRange,
          }];
        }
      }
    }
    return [];
  }

  public async configureAndIndex() {
    if (!this.ctagsPath) {
      this.logger.error('Ctags binary not found. Cross-file features will be disabled.');
      return;
    }
    vscode.workspace.onDidSaveTextDocument(this.onSave.bind(this));
    this.indexWorkspace();
  }


  public indexWorkspace(): void {
    if (!this.ctagsPath) {
      this.indexingPromise = Promise.resolve();
      return;
    }
    this.logger.info('[Indexer] Starting workspace indexing...');

    this.indexingPromise = (async () => {
      this.fileSymbols.clear();
      this.referencesMap.clear();
      const files = await vscode.workspace.findFiles('**/*.{v,sv,vh,svh,vhd,vhdl}', '**/node_modules/**');
      this.logger.info(`[Indexer] Found ${files.length} files to index.`);
      const promises = files.map((file) => this.indexFile(file.fsPath));
      await Promise.all(promises);
      this.logger.info(`[Indexer] Workspace indexing complete.`);
      this.logger.info(`[Indexer] Total indexed files with symbols: ${this.fileSymbols.size}`);
      let totalSymbols = 0;
      this.fileSymbols.forEach(symbols => totalSymbols += symbols.length);
      this.logger.info(`[Indexer] Total symbols found: ${totalSymbols}`);
      let totalRefs = 0;
      this.referencesMap.forEach(refs => totalRefs += refs.length);
      this.logger.info(`[Indexer] Total module references found: ${totalRefs}`);
    })();
  }

  public async indexFile(filePath: string): Promise<void> {
    if (!this.ctagsPath) return;

    this.fileSymbols.delete(vscode.Uri.file(filePath).toString());
    this.clearReferencesFromFile(filePath);

    const ctagsOutput = await this.execCtags(filePath);
    
    const newSymbols: Symbol[] = [];
    if (ctagsOutput) {
      const lines: string[] = ctagsOutput.split(/\r?\n/);
      lines.forEach((line) => {
        if (line) {
          const symbol = this.ctagsParser.parseTagLine(line, filePath);
          if (symbol) {
            newSymbols.push(symbol);
            if (symbol.type === 'instance' && symbol.typeRef) {
              this.addReference(symbol.typeRef, filePath, symbol.startPosition);
            }
          }
        }
      });
    } else {
        this.logger.warn(`[Indexer] No ctags output for file: ${filePath}`);
    }

    let fileContent: string | undefined;
    try {
        fileContent = fs.readFileSync(filePath, 'utf8');
        this.findInstancesWithRegex(fileContent, filePath);
    } catch (e) {
        this.logger.error(`[Indexer-Regex] Failed to read file for regex search: ${filePath}`, e);
    }

    if (newSymbols.length > 0) {
      // 检查 ctags 是否已经提供了结束位置。如果提供了，就不需要再用 calculateEndPositions 回退了
      const allSymbolsHaveEndPos = newSymbols.every(s => s.endPosition.line !== s.startPosition.line);
      if (allSymbolsHaveEndPos) {
          this.fileSymbols.set(vscode.Uri.file(filePath).toString(), newSymbols);
          this.logger.info(`[Indexer] Indexed ${newSymbols.length} symbols (with end pos) from ${path.basename(filePath)}`);
      } else if(fileContent) {
          const completeSymbols = this.calculateEndPositions(fileContent, newSymbols);
          this.fileSymbols.set(vscode.Uri.file(filePath).toString(), completeSymbols);
          this.logger.info(`[Indexer] Indexed ${completeSymbols.length} symbols (calculated end pos) from ${path.basename(filePath)}`);
      } else {
        this.fileSymbols.set(vscode.Uri.file(filePath).toString(), newSymbols);
      }
    }
  }
  
  private addReference(moduleName: string, sourcePath: string, position: vscode.Position) {
    if (!this.referencesMap.has(moduleName)) {
        this.referencesMap.set(moduleName, []);
    }
    const existing = this.referencesMap.get(moduleName)?.find(ref => 
        ref.sourcePath === sourcePath && ref.position.isEqual(position)
    );
    if(!existing) {
        this.referencesMap.get(moduleName)?.push({ sourcePath, position });
    }
  }
  
  private findInstancesWithRegex(content: string, filePath: string) {
    const contentWithoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
    const instanceRegex = /\b(\w+)\b\s*(?:#\s*\([^;]*\))?\s*\b(\w+)\b\s*\(/g;
    
    let match;
    while ((match = instanceRegex.exec(contentWithoutBlockComments)) !== null) {
      const moduleTypeName = match[1];
      const keywords = ['always', 'initial', 'if', 'for', 'case', 'casex', 'casez', 'module', 'begin', 'end', 'generate', 'assign', 'function', 'task'];
      if (keywords.includes(moduleTypeName)) {
        continue;
      }
      
      const startIndex = match.index + match[0].length;
      let balance = 1;
      let endIndex = -1;
      for (let i = startIndex; i < contentWithoutBlockComments.length; i++) {
        if (contentWithoutBlockComments[i] === '/' && contentWithoutBlockComments[i+1] === '/') {
          while(i < contentWithoutBlockComments.length && contentWithoutBlockComments[i] !== '\n') i++;
          if (i >= contentWithoutBlockComments.length) break;
          continue;
        }
        if (contentWithoutBlockComments[i] === '(') balance++;
        else if (contentWithoutBlockComments[i] === ')') balance--;
        
        if (balance === 0) {
          endIndex = i;
          break;
        }
      }
      if (endIndex === -1) {
        continue;
      }

      let foundSemicolon = false;
      for (let i = endIndex + 1; i < contentWithoutBlockComments.length; i++) {
        const char = contentWithoutBlockComments[i];
        if (char === ';') {
          foundSemicolon = true;
          break;
        }
        if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') {
          break;
        }
      }
      if (!foundSemicolon) {
        continue;
      }

      const lineNum = content.substring(0, match.index).split('\n').length - 1;
      const lastNewline = content.lastIndexOf('\n', match.index - 1);
      const colNum = match.index - lastNewline - 1;
      const position = new vscode.Position(lineNum, colNum);

      this.addReference(moduleTypeName, filePath, position);
      this.logger.info(`[Indexer-AdvancedRegex] Found instance of "${moduleTypeName}" in ${path.basename(filePath)} at line ${lineNum + 1}`);
    }
    
    const vhdlInstanceRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+port\s+map\s*\([\s\S]*?\)/gi;
    while ((match = vhdlInstanceRegex.exec(content)) !== null) {
      const componentName = match[2];
      const lineNum = content.substring(0, match.index).split('\n').length - 1;
      const lastNewline = content.lastIndexOf('\n', match.index - 1);
      const colNum = match.index - lastNewline - 1;
      const position = new vscode.Position(lineNum, colNum);

      this.addReference(componentName, filePath, position);
      this.logger.info(`[Indexer-Regex] Found VHDL instance of "${componentName}" in ${path.basename(filePath)} at line ${lineNum + 1}`);
    }
  }

  private clearReferencesFromFile(filePath: string): void {
    for (const [moduleName, references] of this.referencesMap.entries()) {
      const filteredReferences = references.filter(ref => ref.sourcePath !== filePath);
      if (filteredReferences.length === 0) {
        this.referencesMap.delete(moduleName);
      } else {
        this.referencesMap.set(moduleName, filteredReferences);
      }
    }
  }

  // ★★★ execCtags 方法修改 ★★★
  private async execCtags(filepath: string): Promise<string | undefined> {
    if (!this.ctagsPath) return undefined;
    // 从 "--fields=+K" 升级到 "--fields=+neIKs" 
    // n: start line, e: end line, I: inheritance info (typeref), K: kind/type, s: scope
    const command = `"${this.ctagsPath}" -f - --fields=+neIKs --sort=no --excmd=n "${filepath}"`;
    try {
      const { stdout, stderr } = await exec(command);
      if (stderr) {
        this.logger.warn(`[Ctags] ctags stderr for ${path.basename(filepath)}: ${stderr}`);
      }
      return stdout;
    } catch (e) {
      this.logger.error(`[Ctags] Exception executing ctags for ${filepath}. Command: ${command}. Error:`, e);
      vscode.window.showErrorMessage(`Failed to execute ctags for ${path.basename(filepath)}. Check Verilog output panel for details.`);
      return undefined;
    }
  }

  private onSave(doc: vscode.TextDocument) {
    const langId = doc.languageId;
    const supportedLangs = ['verilog', 'systemverilog', 'vhdl'];
    if (supportedLangs.includes(langId)) {
      this.logger.info(`Re-indexing saved file: ${doc.uri.fsPath}`);
      this.indexFile(doc.uri.fsPath);
    }
  }

  public async getSymbols(doc: vscode.TextDocument): Promise<Symbol[]> {
    const docUriString = doc.uri.toString();
    const symbols = this.fileSymbols.get(docUriString);
    if (symbols) {
      return symbols;
    } else {
      this.logger.info(`[Cache Miss] Parsing on-demand for: ${doc.uri.fsPath}`);
      const onDemandSymbols = await this.getSymbolsFromFile(doc.uri.fsPath);
      // ctags现在应能提供结束位置，但保留此作为后备
      return this.calculateEndPositions(doc.getText(), onDemandSymbols);
    }
  }

  public async getSymbolsFromFile(filePath: string): Promise<Symbol[]> {
    const ctagsOutput = await this.execCtags(filePath);
    if (!ctagsOutput) {
        return [];
    }
    const symbols: Symbol[] = [];
    const lines: string[] = ctagsOutput.split(/\r?\n/);
    lines.forEach(line => {
        if (line) {
            const symbol = this.ctagsParser.parseTagLine(line, filePath);
            if (symbol) {
                symbols.push(symbol);
            }
        }
    });
    return symbols;
  }

  // calculateEndPositions 保持不变，作为 ctags 无法提供 end 时的可靠后备方案
  private calculateEndPositions(content: string, symbols: Symbol[]): Symbol[] {
    const lines = content.split(/\r?\n/);
    const containerSymbols = symbols.filter(s => Symbol.isContainer(s.type));
    if (containerSymbols.length === 0) {
      return symbols;
    }

    const endKeywords = {
      module: 'endmodule',
      interface: 'endinterface',
      program: 'endprogram',
      package: 'endpackage',
      function: 'endfunction',
      task: 'endtask',
      class: 'endclass',
      entity: 'end',
      architecture: 'end',
      process: 'end process',
      package_body: 'end'
    };

    for (const symbol of containerSymbols) {
      // ★★★ 新增逻辑 ★★★
      // 如果 ctags 已经提供了有效的结束位置，就跳过计算
      if (symbol.endPosition.line !== symbol.startPosition.line && symbol.endPosition.line < Number.MAX_VALUE) {
          continue;
      }

      const startKeyword = symbol.type;
      const endKeyword = endKeywords[startKeyword];
      if (!endKeyword) continue;

      let depth = 1;
      let foundEnd = false;
      for (let i = symbol.startPosition.line + 1; i < lines.length; i++) {
        let codeLine = lines[i];
        if (codeLine.includes('--')) {
          codeLine = codeLine.split('--')[0];
        }
        if (codeLine.includes('//')) {
          codeLine = codeLine.split('//')[0];
        }
        
        const endRegex = (startKeyword === 'entity' || startKeyword === 'architecture' || startKeyword === 'package_body')
          ? new RegExp(`\\b${endKeyword}\\b(\\s+${startKeyword})?(\\s+${symbol.name})?;`, 'i')
          : new RegExp(`\\b${endKeyword}\\b`);

        const startRegex = new RegExp(`\\b${startKeyword}\\b`, 'i');

        if (startKeyword !== 'process' && startRegex.test(codeLine)) {
          depth++;
        }
        if (endRegex.test(codeLine)) {
          depth--;
        }

        if (depth === 0) {
          symbol.setEndPosition(i);
          foundEnd = true;
          break;
        }
      }
      if (!foundEnd) {
        symbol.setEndPosition(lines.length - 1);
      }
    }
    return symbols;
  }
}
