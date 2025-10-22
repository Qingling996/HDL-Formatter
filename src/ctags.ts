// 文件: src/ctags.ts (最终优化版 - 接收 ctagsPath 注入)

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
  endPosition: vscode.Position;
  parentScope: string;
  parentType: string;
  isValid: boolean;
  path: string;
  typeRef?: string;
  constructor(
    name: string,
    type: string,
    pattern: string,
    startLine: number,
    parentScope: string,
    parentType: string,
    path: string,
    endLine?: number,
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
  public parseTagLine(line: string, filePath: string): Symbol | undefined {
    try {
      let name, type, pattern, lineNoStr, parentScope, parentType: string;
      let typeRef: string | undefined;
      let scope: string[];
      let lineNo: number;
      let parts: string[] = line.split('\t');
      if (parts.length < 4) return undefined;
      name = parts[0];
      type = parts[3];
      if (parts.length == 6 && parts[5] === 'parameter:') {
        type = 'parameter';
      }
      if (parts.length >= 5 && parts[4].includes(':')) {
        scope = parts[4].split(':');
        parentType = scope[0];
        parentScope = scope[1];
      } else {
        parentScope = '';
        parentType = '';
      }
      for (let i = 4; i < parts.length; i++) {
        if (parts[i].startsWith('typeref:')) {
          typeRef = parts[i].substring('typeref:'.length).replace('struct ', '');
        }
      }
      lineNoStr = parts[2];
      lineNo = Number(lineNoStr.slice(0, -2)) - 1;
      pattern = parts[1];
      return new Symbol(name, type, pattern, lineNo, parentScope, parentType, filePath, undefined, undefined, typeRef);
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
  private ctagsPath: string; // ★ 1. 变为必选属性
  private fileSymbols: Map<string, Symbol[]> = new Map();
  private referencesMap: Map<string, ModuleReference[]> = new Map();
  private indexingPromise: Promise<void> | null = null;

  // ★ 2. 构造函数签名改变，直接接收 ctagsPath
  constructor(logger: Logger, context: vscode.ExtensionContext, ctagsPath: string) {
    this.logger = logger;
    this.context = context;
    this.ctagsPath = ctagsPath; // ★ 3. 直接赋值
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
        // Verilog & SystemVerilog
        'module', 'interface', 'program', 'package', 'class',
        'port', 'net', 'register', 'logic', 'wire', 'reg', 'integer', 'real', 'time',
        'parameter', 'localparam', 'constant', 
        'function', 'task', 'typedef', 'enum', 'struct', 'instance',

        // VHDL
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

  // ★ 4. configureAndIndex 不再解析路径
  public async configureAndIndex() {
    // this.ctagsPath = await this.resolveCtagsPath(); // <<< 删除此行
    if (!this.ctagsPath) {
      this.logger.error('Ctags binary not found. Cross-file features will be disabled.');
      return;
    }
    vscode.workspace.onDidSaveTextDocument(this.onSave.bind(this));
    this.indexWorkspace();
  }

  // ★ 5. private async resolveCtagsPath() ... 整个方法被删除 ★★★

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
      if(fileContent) {
        const completeSymbols = this.calculateEndPositions(fileContent, newSymbols);
        this.fileSymbols.set(vscode.Uri.file(filePath).toString(), completeSymbols);
        this.logger.info(`[Indexer] Indexed ${completeSymbols.length} symbols from ${path.basename(filePath)}`);
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

  private async execCtags(filepath: string): Promise<string | undefined> {
    if (!this.ctagsPath) return undefined;
    const command = `"${this.ctagsPath}" -f - --fields=+K --sort=no --excmd=n "${filepath}"`;
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
