// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { execFile as execFileCallback } from 'child_process';
import * as util from 'util';
import { Logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';

const execFile = util.promisify(execFileCallback);

// ... Symbol, CtagsParser 等接口和类的定义保持不变 ...
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
    
    constructor(logger: Logger, context: vscode.ExtensionContext, ctagsPath: string) {
        this.logger = logger;
        this.context = context;
        this.ctagsPath = ctagsPath;
        this.ctagsParser = new CtagsParser(this.logger);
        this.checkCtagsVersion();
    }
    
    private async checkCtagsVersion(): Promise<void> {
        if (!this.ctagsPath) { return; }
        try {
            await execFile(this.ctagsPath, ['--version']);
        } catch (error: any) {
            this.logger.error(`CRITICAL ERROR: Failed to execute ctags.exe. Error: ${error.message}`);
        }
    }
    
    public async waitForIndex(): Promise<void> { if (this.indexingPromise) { await this.indexingPromise; } }
    public getWorkspaceSymbols(): Map<string, Symbol[]> { return this.fileSymbols; }
    public getAllReferences(): Map<string, ModuleReference[]> { return this.referencesMap; }
    public getReferencesForModule(moduleName: string): ModuleReference[] { const lowercaseModuleName = moduleName.toLowerCase(); for (const [key, value] of this.referencesMap.entries()) { if (key.toLowerCase() === lowercaseModuleName) { return value; } } return []; }

    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★  核心修改区域：findSymbol 方法  ★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    public async findSymbol(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DefinitionLink[]> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) { return []; }
        const word = document.getText(range);
        const keywords = new Set(['module', 'endmodule', 'begin', 'end', 'if', 'else', 'always', 'initial', 'assign', 'entity', 'architecture', 'process']);
        if (keywords.has(word)) { return []; }
        
        // 步骤 1: 作用域内查找 (保持不变)
        const currentFileSymbols = this.fileSymbols.get(document.uri.toString());
        if (currentFileSymbols) {
            let enclosingScopeName: string | undefined = undefined;
            for (let i = currentFileSymbols.length - 1; i >= 0; i--) {
                const s = currentFileSymbols[i];
                if (Symbol.isContainer(s.type) && s.startPosition.line <= position.line && s.endPosition.line >= position.line) {
                    enclosingScopeName = s.name;
                    break; 
                }
            }
            if (enclosingScopeName) {
                this.logger.info(`[GoToDef] Proximity search for "${word}" within scope "${enclosingScopeName}"`);
                for (const symbolsInFile of this.fileSymbols.values()) {
                    for (const symbol of symbolsInFile) {
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
        
        // 步骤 2: 全局查找 - 优先查找模块/实体定义 (新增逻辑)
        this.logger.info(`[GoToDef] Global search for module/entity definition "${word}"`);
        for (const symbolsInFile of this.fileSymbols.values()) {
            for (const symbol of symbolsInFile) {
                if (symbol.name.toLowerCase() === word.toLowerCase() && (symbol.type === 'module' || symbol.type === 'entity')) {
                    this.logger.info(`[GoToDef] Found definition '${symbol.name}' of type '${symbol.type}' in ${path.basename(symbol.path)}`);
                    const targetUri = vscode.Uri.file(symbol.path);
                    const targetRange = new vscode.Range(symbol.startPosition, symbol.startPosition);
                    return [{ originSelectionRange: range, targetUri, targetRange }];
                }
            }
        }
        
        // 步骤 3: 全局查找 - 兜底查找任何同名符号 (原逻辑)
        this.logger.info(`[GoToDef] No definition found. Falling back to global search for any symbol named "${word}"`);
        for (const symbolsInFile of this.fileSymbols.values()) {
            for (const symbol of symbolsInFile) {
                if (symbol.name.toLowerCase() === word.toLowerCase()) {
                    this.logger.info(`[GoToDef] Found fallback symbol in ${path.basename(symbol.path)}`);
                    const targetUri = vscode.Uri.file(symbol.path);
                    const targetRange = new vscode.Range(symbol.startPosition, symbol.startPosition);
                    return [{ originSelectionRange: range, targetUri, targetRange }];
                }
            }
        }

        return [];
    }
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★★★★★  核心修改区域结束  ★★★★★★★★★★★★★★★★★★★
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

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
    
    private findInstancesWithRegex(content: string, filePath: string, symbols: Symbol[]) {
      const isVHDL = filePath.toLowerCase().endsWith('.vhd') || filePath.toLowerCase().endsWith('.vhdl');
      if (isVHDL) {
          const archBodyRegex = /\barchitecture\b[\s\S]*?\bbegin\b([\s\S]*)/i;
          const archBodyMatch = archBodyRegex.exec(content);
          if (!archBodyMatch) { return; }
          const bodyContent = archBodyMatch[1];
          const bodyOffset = archBodyMatch.index + archBodyMatch[0].length - bodyContent.length;

          // 步骤 1: 预处理，将所有VHDL注释替换为空格，同时保持原有的行列结构不变。
          // 这是最安全、最高性能的方案，可以从根本上避免正则表达式的性能陷阱。
          const sanitizedBodyContent = bodyContent.replace(/--[^\r\n]*/g, match => ' '.repeat(match.length));
          // 步骤 2: 使用您认可的、结构最稳定的“好版本”正则表达式。
          // 因为注释已经被处理，这个简单而严格的正则现在可以完美工作了。
          const vhdlInstanceRegex = new RegExp(
            // 匹配 "实例名 : 类型名"
            '\\b([\\w\\d_]+)\\s*:\\s*(?:entity\\s+)?(?:work\\.)?([\\w\\d_]+)(?:\\([\\w\\d_]+\\))?' +
            // 匹配可选的 generic map，用 \s* 连接，因为注释已不存在
            '\\s*(?:generic(?:\\s+map)?\\s*\\([\\s\\S]*?\\))?' +
            // 匹配必需的 port map，用 \s* 连接
            '\\s*port(?:\\s+map)?\\s*\\([\\s\\S]*?\\);',
            'gi'
          );
          let vhdlMatch;
          // 步骤 3: 在“净化后”的内容上执行匹配。
          while ((vhdlMatch = vhdlInstanceRegex.exec(sanitizedBodyContent)) !== null) {
            // 尽管匹配在净化内容上进行，但捕获的组和索引对于原始文本仍然有效。
            const fullMatchText = vhdlMatch[0];
            const instanceName = vhdlMatch[1];
            const moduleTypeName = vhdlMatch[2];
            const colonIndexInMatch = fullMatchText.indexOf(':');
            if (colonIndexInMatch === -1) continue;
            const offsetToModuleType = fullMatchText.indexOf(moduleTypeName, colonIndexInMatch);
            if (offsetToModuleType === -1) continue;
            // 使用原始的 content 和 bodyOffset 来计算精确位置
            const matchStartIndexInFullFile = bodyOffset + vhdlMatch.index;
            const moduleTypeIndexInFullFile = matchStartIndexInFullFile + offsetToModuleType;
            const precedingText = content.substring(0, moduleTypeIndexInFullFile);
            const lineNum = (precedingText.match(/\n/g) || []).length;
            const lastNewline = precedingText.lastIndexOf('\n');
            const colNum = moduleTypeIndexInFullFile - lastNewline - 1;
            this.addReference(moduleTypeName, filePath, new vscode.Position(lineNum, colNum), instanceName);
          }
        return;
      }

      let contentCleaned = content.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
      contentCleaned = contentCleaned.replace(/\/\/[^\r\n]*/g, (match) => ' '.repeat(match.length));
      
      const blacklist = ['always', 'initial', 'if', 'for', 'case', 'casex', 'casez', 'module', 'begin', 'end', 'generate', 'assign', 'function', 'task', 'and', 'nand', 'or', 'nor', 'xor', 'xnor', 'buf', 'not', 'bufif0', 'bufif1', 'notif0', 'notif1', 'tranif0', 'tranif1', 'rtranif1', 'rtranif0', 'tran', 'rtran', 'pullup', 'pulldown', 'nmos', 'pmos', 'cmos', 'rnmos', 'rpmos', 'rcmos'];
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
          const isInProceduralBlock = symbols.some(s => (s.type === 'task' || s.type === 'function') && s.endPosition && s.startPosition.line < lineNum && s.endPosition.line > lineNum);
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
    
    private async execCtags(filepath: string): Promise<string | undefined> { 
        if (!this.ctagsPath) { return undefined; }
        const args: string[] = ['-f', '-', '--fields=+neIKs', '--sort=no', '--excmd=n', '--kinds-vhdl=+e', '--kinds-verilog=+mf', '--kinds-systemverilog=+mf', filepath];
        try { 
            const { stdout, stderr } = await execFile(this.ctagsPath, args); 
            if (stderr && !stderr.includes("Unsupported parameter 'I' for \"fields\" option")) { 
                this.logger.warn(`[Ctags] Unexpected stderr for ${path.basename(filepath)}: ${stderr}`); 
            } 
            return stdout; 
        } 
        catch (e: any) { 
            this.logger.error(`[Ctags] Exception during ctags execution for ${filepath}.`, e); 
            if (e.stderr) { this.logger.error(`[Ctags] Exception stderr: ${e.stderr}`); }
            return undefined; 
        } 
    }

    private onSave(doc: vscode.TextDocument) { const langId = doc.languageId; const supportedLangs = ['verilog', 'systemverilog', 'vhdl']; if (supportedLangs.includes(langId)) { this.indexFile(doc.uri.fsPath); } }
    public async getSymbols(doc: vscode.TextDocument): Promise<Symbol[]> { const docUriString = doc.uri.toString(); const symbols = this.fileSymbols.get(docUriString); if (symbols) { return symbols; } else { const onDemandSymbols = await this.getSymbolsFromFile(doc.uri.fsPath); return this.calculateEndPositions(doc.getText(), onDemandSymbols); } }
    public async getSymbolsFromFile(filePath: string): Promise<Symbol[]> { const ctagsOutput = await this.execCtags(filePath); if (!ctagsOutput) { return []; } const symbols: Symbol[] = []; const lines: string[] = ctagsOutput.split(/\r?\n/); lines.forEach(line => { if (line) { const symbol = this.ctagsParser.parseTagLine(line, filePath); if (symbol) { symbols.push(symbol); } } }); return symbols; }
    private calculateEndPositions(content: string, symbols: Symbol[]): Symbol[] { const lines = content.split(/\r?\n/); const containerSymbols = symbols.filter(s => Symbol.isContainer(s.type)); if (containerSymbols.length === 0) { return symbols; } const endKeywords = { module: 'endmodule', interface: 'endinterface', program: 'endprogram', package: 'endpackage', function: 'endfunction', task: 'endtask', class: 'endclass', entity: 'end', architecture: 'end', process: 'end process', package_body: 'end' }; for (const symbol of containerSymbols) { if (symbol.endPosition.line !== symbol.startPosition.line && symbol.endPosition.line < Number.MAX_VALUE) { continue; } const startKeyword = symbol.type; const endKeyword = endKeywords[startKeyword]; if (!endKeyword) continue; let depth = 1, foundEnd = false; for (let i = symbol.startPosition.line + 1; i < lines.length; i++) { let codeLine = lines[i]; if (codeLine.includes('--')) { codeLine = codeLine.split('--')[0]; } if (codeLine.includes('//')) { codeLine = codeLine.split('//')[0]; } const endRegex = (startKeyword === 'entity' || startKeyword === 'architecture' || startKeyword === 'package_body') ? new RegExp(`\\b${endKeyword}\\b(\\s+${startKeyword})?(\\s+${symbol.name})?;`, 'i') : new RegExp(`\\b${endKeyword}\\b`); const startRegex = new RegExp(`\\b${startKeyword}\\b`, 'i'); if (startKeyword !== 'process' && startRegex.test(codeLine)) { depth++; } if (endRegex.test(codeLine)) { depth--; } if (depth === 0) { symbol.setEndPosition(i); foundEnd = true; break; } } if (!foundEnd) { symbol.setEndPosition(lines.length - 1); } } return symbols; }
}
