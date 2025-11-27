// 文件: src/ctags.ts (就近匹配版 - 优先跳转当前范围内的定义)

// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { exec as execNonPromise } from 'child_process';
import * as util from 'util';
import { Logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';

const exec = util.promisify(execNonPromise);

// ... Symbol, CtagsParser, ModuleReference 等接口和类的定义保持不变 ...
export interface ModuleReference {
  sourcePath: string;
  position: vscode.Position;
  instanceName: string;
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
  scope?: string; 
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

  setEndPosition(endLine: number) { this.endPosition = new vscode.Position(endLine, Number.MAX_VALUE); this.isValid = true; }
  getDocumentSymbol(): vscode.DocumentSymbol { let range = new vscode.Range(this.startPosition, this.endPosition); return new vscode.DocumentSymbol(this.name, this.type, Symbol.getSymbolKind(this.type), range, range); }
  static isContainer(type: string): boolean { switch (type) { case 'function': case 'module': case 'task': case 'block': case 'class': case 'covergroup': case 'enum': case 'interface': case 'package': case 'program': case 'struct': return true; case 'entity': case 'architecture': case 'process': case 'package_body': return true; default: return false; } }
  static getSymbolKind(name: String): vscode.SymbolKind { switch (name) { case 'constant': return vscode.SymbolKind.Constant; case 'parameter': return vscode.SymbolKind.Constant; case 'event': return vscode.SymbolKind.Event; case 'function': return vscode.SymbolKind.Function; case 'module': return vscode.SymbolKind.Module; case 'net': return vscode.SymbolKind.Variable; case 'port': return vscode.SymbolKind.Boolean; case 'register': return vscode.SymbolKind.Variable; case 'task': return vscode.SymbolKind.Function; case 'block': return vscode.SymbolKind.Module; case 'assert': return vscode.SymbolKind.Variable; case 'class': return vscode.SymbolKind.Class; case 'covergroup': return vscode.SymbolKind.Class; case 'enum': return vscode.SymbolKind.Enum; case 'interface': return vscode.SymbolKind.Interface; case 'modport': return vscode.SymbolKind.Boolean; case 'package': return vscode.SymbolKind.Package; case 'program': return vscode.SymbolKind.Module; case 'prototype': return vscode.SymbolKind.Function; case 'property': return vscode.SymbolKind.Property; case 'struct': return vscode.SymbolKind.Struct; case 'typedef': return vscode.SymbolKind.TypeParameter; case 'entity': return vscode.SymbolKind.Class; case 'architecture': return vscode.SymbolKind.Module; case 'process': return vscode.SymbolKind.Function; case 'signal': return vscode.SymbolKind.Variable; case 'variable': return vscode.SymbolKind.Variable; case 'literal': return vscode.SymbolKind.EnumMember; case 'package_body': return vscode.SymbolKind.Package; default: return vscode.SymbolKind.Variable; } }
}

export class CtagsParser {
  private logger: Logger;
  constructor(logger: Logger) { this.logger = logger; }
  public parseTagLine(line: string, filePath: string): Symbol | undefined { try { let name, type, pattern, lineNoStr, parentScope, parentType: string; let typeRef: string | undefined, endLine: number | undefined, scope: string[], lineNo: number; let parts: string[] = line.split('\t'); if (parts.length < 4) return undefined; name = parts[0]; pattern = parts[1]; lineNoStr = parts[2]; lineNo = Number(lineNoStr.slice(0, -2)) - 1; type = 'unknown', parentScope = '', parentType = ''; for (let i = 3; i < parts.length; i++) { const part = parts[i]; if (i === 3) { type = part; continue; } if (part.startsWith('typeref:')) { typeRef = part.substring('typeref:'.length).replace('struct ', ''); } else if (part.startsWith('end:')) { endLine = parseInt(part.substring('end:'.length), 10) - 1; } else if (part.startsWith('scope:')) { const scopeInfo = part.substring('scope:'.length); const scopeParts = scopeInfo.split(':'); if(scopeParts.length === 2) { parentType = scopeParts[0]; parentScope = scopeParts[1]; } } else if (part.includes(':') && !part.startsWith('line:')) { scope = part.split(':'); parentType = scope[0]; parentScope = scope[1]; } } if (parts.length == 6 && parts[5] === 'parameter:') { type = 'parameter'; } return new Symbol(name, type, pattern, lineNo, parentScope, parentType, filePath, endLine, undefined, typeRef); } catch (e) { this.logger.error('Line Parser: ' + e + ' on line ' + line); return undefined; } }
}

export class CtagsManager {
    private logger: Logger;
    private context: vscode.ExtensionContext;
    private ctagsParser: CtagsParser;
    private ctagsPath: string;
    private fileSymbols: Map<string, Symbol[]> = new Map();
    private referencesMap: Map<string, ModuleReference[]> = new Map();
    private indexingPromise: Promise<void> | null = null;
    
    constructor(logger: Logger, context: vscode.ExtensionContext, ctagsPath: string) { this.logger = logger; this.context = context; this.ctagsPath = ctagsPath; this.ctagsParser = new CtagsParser(this.logger); }
    public async waitForIndex(): Promise<void> { if (this.indexingPromise) { await this.indexingPromise; } }
    public getWorkspaceSymbols(): Map<string, Symbol[]> { return this.fileSymbols; }
    public getAllReferences(): Map<string, ModuleReference[]> { return this.referencesMap; }
    public getReferencesForModule(moduleName: string): ModuleReference[] { const lowercaseModuleName = moduleName.toLowerCase(); for (const [key, value] of this.referencesMap.entries()) { if (key.toLowerCase() === lowercaseModuleName) { return value; } } return []; }

    // ★★★★★★★★★★★★★★★★★ 核心修改: findSymbol 函数升级为两阶段查找 ★★★★★★★★★★★★★★★★★
    public async findSymbol(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DefinitionLink[]> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) { return []; }
        const word = document.getText(range);
        
        const keywords = new Set(['module', 'endmodule', 'begin', 'end', 'if', 'else', 'always', 'initial', 'assign', 'entity', 'architecture', 'process']);
        if (keywords.has(word)) { return []; }

        // --- 阶段一: 精准查找 (就近匹配) ---
        
        // 1. 获取当前文件的所有符号
        const currentFileSymbols = this.fileSymbols.get(document.uri.toString());
        if (currentFileSymbols) {
            // 2. 找到光标所在的容器符号 (module, task, function等)
            let enclosingScopeName: string | undefined = undefined;
            // 从后往前遍历, 优先找到最内层的范围
            for (let i = currentFileSymbols.length - 1; i >= 0; i--) {
                const s = currentFileSymbols[i];
                if (Symbol.isContainer(s.type) && s.startPosition.line <= position.line && s.endPosition.line >= position.line) {
                    enclosingScopeName = s.name;
                    break; 
                }
            }

            // 3. 如果找到了当前范围, 则进行一次限定范围的搜索
            if (enclosingScopeName) {
                this.logger.info(`[GoToDef] Proximity search for "${word}" within scope "${enclosingScopeName}"`);
                for (const symbolsInFile of this.fileSymbols.values()) {
                    for (const symbol of symbolsInFile) {
                        // 条件: 名字匹配 且 父级范围匹配
                        if (symbol.name.toLowerCase() === word.toLowerCase() && symbol.parentScope === enclosingScopeName) {
                            this.logger.info(`[GoToDef] Found scoped match in ${path.basename(symbol.path)}`);
                            const targetUri = vscode.Uri.file(symbol.path);
                            const targetRange = new vscode.Range(symbol.startPosition, symbol.startPosition);
                            return [{ originSelectionRange: range, targetUri, targetRange }];
                        }
                    }
                }
            }
        }

        // --- 阶段二: 全局回退查找 ---
        // 如果阶段一没找到 (比如点击的是模块名, 或者没找到当前范围), 则执行原来的全局查找
        this.logger.info(`[GoToDef] No scoped match found. Falling back to global search for "${word}"`);
        for (const symbolsInFile of this.fileSymbols.values()) {
            for (const symbol of symbolsInFile) {
                if (symbol.name.toLowerCase() === word.toLowerCase()) {
                    const targetUri = vscode.Uri.file(symbol.path);
                    const targetRange = new vscode.Range(symbol.startPosition, symbol.startPosition);
                    return [{ originSelectionRange: range, targetUri, targetRange }];
                }
            }
        }
        
        return [];
    }

    public async configureAndIndex() { if (!this.ctagsPath) { this.logger.error('Ctags binary not found.'); return; } vscode.workspace.onDidSaveTextDocument(this.onSave.bind(this)); this.indexWorkspace(); }
    public indexWorkspace(): void { if (!this.ctagsPath) { this.indexingPromise = Promise.resolve(); return; } this.logger.info('[Indexer] Starting workspace indexing...'); this.indexingPromise = (async () => { this.fileSymbols.clear(); this.referencesMap.clear(); const files = await vscode.workspace.findFiles('**/*.{v,sv,vh,svh,vhd,vhdl}', '**/node_modules/**'); const promises = files.map((file) => this.indexFile(file.fsPath)); await Promise.all(promises); this.logger.info(`[Indexer] Workspace indexing complete.`); })(); }

    public async indexFile(filePath: string): Promise<void> {
      if (!this.ctagsPath) return;
      this.fileSymbols.delete(vscode.Uri.file(filePath).toString());
      this.clearReferencesFromFile(filePath);
      const ctagsOutput = await this.execCtags(filePath);
      const newSymbols: Symbol[] = [];
      if (ctagsOutput) {
        const lines: string[] = ctagsOutput.split(/\r?\n/);
        lines.forEach((line) => { if (line) { const symbol = this.ctagsParser.parseTagLine(line, filePath); if (symbol) { newSymbols.push(symbol); } } });
      }
      let fileContent: string | undefined;
      try {
          fileContent = fs.readFileSync(filePath, 'utf8');
          this.findInstancesWithRegex(fileContent, filePath, newSymbols);
      } catch (e) {
          this.logger.error(`[Indexer] Failed to read file or find instances: ${filePath}`, e);
      }
      if (newSymbols.length > 0) {
        if(fileContent) {
            const completeSymbols = this.calculateEndPositions(fileContent, newSymbols);
            this.fileSymbols.set(vscode.Uri.file(filePath).toString(), completeSymbols);
        } else {
          this.fileSymbols.set(vscode.Uri.file(filePath).toString(), newSymbols);
        }
      }
    }

    private addReference(moduleTypeName: string, sourcePath: string, position: vscode.Position, instanceName: string) { if (!this.referencesMap.has(moduleTypeName)) { this.referencesMap.set(moduleTypeName, []); } const references = this.referencesMap.get(moduleTypeName)!; const existing = references.find(ref => ref.sourcePath === sourcePath && ref.instanceName === instanceName); if(!existing) { references.push({ sourcePath, position, instanceName }); } }
    
    // findInstancesWithRegex 函数保持我们上次修复后的最终形态，无需改动
    private findInstancesWithRegex(content: string, filePath: string, symbols: Symbol[]) {
      const isVHDL = filePath.toLowerCase().endsWith('.vhd') || filePath.toLowerCase().endsWith('.vhdl');
      if (isVHDL) {
          const vhdlContentWithoutComments = content.replace(/--.*/g, '');
          const vhdlInstanceRegex = /\b(\w+)\s*:\s*(?:entity\s+)?(?:work\.)?([\w\d_]+)\s*(?:\(.*\))?\s*?(?:generic\s+map|port\s+map)/gi;
          let vhdlMatch;
          while ((vhdlMatch = vhdlInstanceRegex.exec(vhdlContentWithoutComments)) !== null) {
              const instanceName = vhdlMatch[1];
              const moduleTypeName = vhdlMatch[2];
              const precedingText = content.substring(0, vhdlMatch.index);
              const lineNum = (precedingText.match(/\n/g) || []).length;
              const lastNewline = precedingText.lastIndexOf('\n');
              const colNum = vhdlMatch.index - lastNewline - 1;
              this.addReference(moduleTypeName, filePath, new vscode.Position(lineNum, colNum), instanceName);
          }
          return;
      }
      
      let contentCleaned = content.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
      contentCleaned = contentCleaned.replace(/\/\/[^\r\n]*/g, (match) => ' '.repeat(match.length));
      
      const blacklist = [
          'always', 'initial', 'if', 'for', 'case', 'casex', 'casez', 'module', 'begin', 'end', 'generate', 'assign', 'function', 'task',
          'and', 'nand', 'or', 'nor', 'xor', 'xnor', 'buf', 'not',
          'bufif0', 'bufif1', 'notif0', 'notif1',
          'tranif0', 'tranif1', 'rtranif1', 'rtranif0', 'tran', 'rtran',
          'pullup', 'pulldown',
          'nmos', 'pmos', 'cmos', 'rnmos', 'rpmos', 'rcmos'
      ];
      
      const taskNames = new Set<string>();
      symbols.forEach(s => { if (s.type === 'task') { taskNames.add(s.name); } });

      const instanceRegex = /\b([a-zA-Z_]\w*)\b\s*(?:#\s*\([^;]*\))?\s+\b([a-zA-Z_]\w*)\b\s*\(/g;
      
      let match;
      while ((match = instanceRegex.exec(contentCleaned)) !== null) {
          const moduleTypeName = match[1];
          if (blacklist.includes(moduleTypeName)) { continue; }
          if (taskNames.has(moduleTypeName)) { continue; }
          
          const precedingText = content.substring(0, match.index);
          const lineNum = (precedingText.match(/\n/g) || []).length;
          const lastNewline = precedingText.lastIndexOf('\n');
          const colNum = match.index - lastNewline - 1;

          const isInProceduralBlock = symbols.some(s => 
              (s.type === 'task' || s.type === 'function') &&
              s.endPosition && s.startPosition.line < lineNum && s.endPosition.line > lineNum
          );
          if (isInProceduralBlock) { continue; }

          const instanceName = match[2];
          const startIndex = match.index + match[0].length;
          let balance = 1, endIndex = -1;
          for (let i = startIndex; i < contentCleaned.length; i++) {
              if (contentCleaned[i] === '(') balance++; 
              else if (contentCleaned[i] === ')') balance--; 
              if (balance === 0) { endIndex = i; break; } 
          }
          if (endIndex === -1) { continue; }
          let foundSemicolon = false;
          for (let i = endIndex + 1; i < contentCleaned.length; i++) { 
              const char = contentCleaned[i]; 
              if (char === ';') { foundSemicolon = true; break; } 
              if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') { break; } 
          }
          if (!foundSemicolon) { continue; }
    
          const position = new vscode.Position(lineNum, colNum);
          this.addReference(moduleTypeName, filePath, position, instanceName);
      }
    }

    private clearReferencesFromFile(filePath: string): void { for (const [moduleName, references] of this.referencesMap.entries()) { const filteredReferences = references.filter(ref => ref.sourcePath !== filePath); if (filteredReferences.length === 0) { this.referencesMap.delete(moduleName); } else { this.referencesMap.set(moduleName, filteredReferences); } } }
    private async execCtags(filepath: string): Promise<string | undefined> { if (!this.ctagsPath) return undefined; const command = `"${this.ctagsPath}" -f - --fields=+neIKs --sort=no --excmd=n --kinds-vhdl=+e --kinds-verilog=+mf --kinds-systemverilog=+mf "${filepath}"`; try { const { stdout, stderr } = await exec(command); if (stderr) { this.logger.warn(`[Ctags] stderr for ${path.basename(filepath)}: ${stderr}`); } return stdout; } catch (e) { this.logger.error(`[Ctags] Exception for ${filepath}.`, e); return undefined; } }
    private onSave(doc: vscode.TextDocument) { const langId = doc.languageId; const supportedLangs = ['verilog', 'systemverilog', 'vhdl']; if (supportedLangs.includes(langId)) { this.indexFile(doc.uri.fsPath); } }
    public async getSymbols(doc: vscode.TextDocument): Promise<Symbol[]> { const docUriString = doc.uri.toString(); const symbols = this.fileSymbols.get(docUriString); if (symbols) { return symbols; } else { const onDemandSymbols = await this.getSymbolsFromFile(doc.uri.fsPath); return this.calculateEndPositions(doc.getText(), onDemandSymbols); } }
    public async getSymbolsFromFile(filePath: string): Promise<Symbol[]> { const ctagsOutput = await this.execCtags(filePath); if (!ctagsOutput) { return []; } const symbols: Symbol[] = []; const lines: string[] = ctagsOutput.split(/\r?\n/); lines.forEach(line => { if (line) { const symbol = this.ctagsParser.parseTagLine(line, filePath); if (symbol) { symbols.push(symbol); } } }); return symbols; }
    private calculateEndPositions(content: string, symbols: Symbol[]): Symbol[] { const lines = content.split(/\r?\n/); const containerSymbols = symbols.filter(s => Symbol.isContainer(s.type)); if (containerSymbols.length === 0) { return symbols; } const endKeywords = { module: 'endmodule', interface: 'endinterface', program: 'endprogram', package: 'endpackage', function: 'endfunction', task: 'endtask', class: 'endclass', entity: 'end', architecture: 'end', process: 'end process', package_body: 'end' }; for (const symbol of containerSymbols) { if (symbol.endPosition.line !== symbol.startPosition.line && symbol.endPosition.line < Number.MAX_VALUE) { continue; } const startKeyword = symbol.type; const endKeyword = endKeywords[startKeyword]; if (!endKeyword) continue; let depth = 1, foundEnd = false; for (let i = symbol.startPosition.line + 1; i < lines.length; i++) { let codeLine = lines[i]; if (codeLine.includes('--')) { codeLine = codeLine.split('--')[0]; } if (codeLine.includes('//')) { codeLine = codeLine.split('//')[0]; } const endRegex = (startKeyword === 'entity' || startKeyword === 'architecture' || startKeyword === 'package_body') ? new RegExp(`\\b${endKeyword}\\b(\\s+${startKeyword})?(\\s+${symbol.name})?;`, 'i') : new RegExp(`\\b${endKeyword}\\b`); const startRegex = new RegExp(`\\b${startKeyword}\\b`, 'i'); if (startKeyword !== 'process' && startRegex.test(codeLine)) { depth++; } if (endRegex.test(codeLine)) { depth--; } if (depth === 0) { symbol.setEndPosition(i); foundEnd = true; break; } } if (!foundEnd) { symbol.setEndPosition(lines.length - 1); } } return symbols; }
}
