import * as vscode from 'vscode';
import * as path from 'path';
import { CtagsManager, Symbol, ModuleReference } from '../ctags';

interface ModuleInfo {
symbol?: Symbol;
children: ModuleInstance[];
isInstantiated: boolean;
isMissing: boolean;
}

interface ModuleInstance {
instanceName: string;
moduleName: string;
parentSymbol: Symbol; 
instancePosition: vscode.Position;
instanceFilePath: string;
}

export class VerilogTreeDataProvider implements vscode.TreeDataProvider<ModuleNode> {
private _onDidChangeTreeData: vscode.EventEmitter<ModuleNode | undefined> = new vscode.EventEmitter<ModuleNode | undefined>();
readonly onDidChangeTreeData: vscode.Event<ModuleNode | undefined> = this._onDidChangeTreeData.event;

constructor(
private workspaceRoot: string,
private ctags: CtagsManager,
private context: vscode.ExtensionContext
) { }

getTreeItem(element: ModuleNode): vscode.TreeItem { return element; }

getChildren(element?: ModuleNode): Thenable<ModuleNode[]> {
if (!this.workspaceRoot) { return Promise.resolve([]); }
if (element) { return Promise.resolve(element.children); }
return this.buildTreeFromWorkspace();
}

refresh(): void { this._onDidChangeTreeData.fire(undefined); }

private async buildTreeFromWorkspace(): Promise<ModuleNode[]> {
await this.ctags.waitForIndex();

const moduleInfos = new Map<string, ModuleInfo>();
const workspaceSymbols = this.ctags.getWorkspaceSymbols();
const lowercaseNameToOriginalNameMap = new Map<string, string>();
const fileToEntityMap = new Map<string, Symbol>();

// 步骤 1: 收集所有符号 (逻辑不变)
for (const symbolsInFile of workspaceSymbols.values()) {
const entityInFile = symbolsInFile.find(s => s.type === 'entity');
if (entityInFile) {
fileToEntityMap.set(entityInFile.path, entityInFile);
}

for (const symbol of symbolsInFile) {
if (['module', 'interface', 'entity'].includes(symbol.type)) {
if (!moduleInfos.has(symbol.name)) {
moduleInfos.set(symbol.name, { symbol, children: [], isInstantiated: false, isMissing: false });
lowercaseNameToOriginalNameMap.set(symbol.name.toLowerCase(), symbol.name);
}
}
}
}

// 步骤 2: 遍历所有实例化关系 (逻辑不变)
const allReferences = this.ctags.getAllReferences(); 

for (const [moduleTypeName, references] of allReferences.entries()) {
const originalChildModuleName = lowercaseNameToOriginalNameMap.get(moduleTypeName.toLowerCase());
let childModuleInfo: ModuleInfo | undefined;

if (originalChildModuleName) {
childModuleInfo = moduleInfos.get(originalChildModuleName);
} else {
if (!moduleInfos.has(moduleTypeName)) {
moduleInfos.set(moduleTypeName, { children: [], isInstantiated: false, isMissing: true });
}
childModuleInfo = moduleInfos.get(moduleTypeName);
}
if (!childModuleInfo) { continue; }

for (const ref of references) {
const symbolsInFile = workspaceSymbols.get(vscode.Uri.file(ref.sourcePath).toString()) || [];
const parentCandidates = symbolsInFile.filter(s => ['module', 'entity', 'architecture'].includes(s.type));
const directParentSymbol = this.findParentModule(ref.position, parentCandidates);
if (!directParentSymbol) { continue; }

this.linkParentAndChild(
directParentSymbol, 
ref.instanceName,
moduleTypeName,
childModuleInfo, 
moduleInfos, 
lowercaseNameToOriginalNameMap, 
fileToEntityMap,
ref.position,
ref.sourcePath
);
}
}

// 步骤 3: 构建最终的树结构 (逻辑不变)
const rootNodes: ModuleNode[] = [];
for (const [name, info] of moduleInfos.entries()) {
if (!info.isInstantiated && !info.isMissing) {
const node = this.createModuleNode(name, info, moduleInfos, new Set<string>());
rootNodes.push(node);
}
}
// 顶层模块仍然按字母排序，这符合习惯
return rootNodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
}

// linkParentAndChild 函数保持不变
private linkParentAndChild(
directParentSymbol: Symbol,
instanceName: string,
childModuleTypeName: string,
childModuleInfo: ModuleInfo,
moduleInfos: Map<string, ModuleInfo>,
lowercaseMap: Map<string, string>,
fileToEntityMap: Map<string, Symbol>,
instancePosition: vscode.Position,
instanceFilePath: string
) {
let logicalParentName: string | undefined;

if (directParentSymbol.type === 'architecture') {
if (directParentSymbol.parentScope) {
logicalParentName = directParentSymbol.parentScope;
} 
else {
const entitySymbol = fileToEntityMap.get(directParentSymbol.path);
if (entitySymbol) {
logicalParentName = entitySymbol.name;
}
}
} else {
logicalParentName = directParentSymbol.name;
}

if (!logicalParentName) { return; }

const originalParentName = lowercaseMap.get(logicalParentName.toLowerCase());
if (!originalParentName) { return; }

const parentModuleInfo = moduleInfos.get(originalParentName);
if (!parentModuleInfo) { return; }

childModuleInfo.isInstantiated = true;

parentModuleInfo.children.push({ 
instanceName: instanceName, 
moduleName: childModuleTypeName,
parentSymbol: directParentSymbol,
instancePosition: instancePosition,
instanceFilePath: instanceFilePath
});
}

private createModuleNode(moduleName: string, info: ModuleInfo, allModules: Map<string, ModuleInfo>, visited: Set<string>): ModuleNode {
if (visited.has(moduleName)) {
const leafNode = new ModuleNode(moduleName, info, vscode.TreeItemCollapsibleState.None, this.context);
leafNode.label = `${moduleName} (recursive)`;
leafNode.iconPath = new vscode.ThemeIcon('debug-breakpoint-log-disabled');
return leafNode;
}

visited.add(moduleName);
const hasChildren = info.children.length > 0;
const collapsibleState = hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
const node = new ModuleNode(moduleName, info, collapsibleState, this.context);

if (hasChildren) {
// ★★★★★★★★★★★★★★★★★★★★★★★ 核心修复 ★★★★★★★★★★★★★★★★★★★★★★★
// 1. 先对原始的 children 数组按行号进行排序
node.children = info.children.sort((a, b) => {
return a.instancePosition.line - b.instancePosition.line;
})
// 2. 然后再将已排序的数组映射为 ModuleNode
.map(instance => {
const originalChildModuleName = [...allModules.keys()].find(key => key.toLowerCase() === instance.moduleName.toLowerCase());
if (!originalChildModuleName) return null;

const childModuleInfo = allModules.get(originalChildModuleName);
if (childModuleInfo) {
const childNode = this.createModuleNode(originalChildModuleName, childModuleInfo, allModules, new Set(visited));
childNode.label = `${instance.instanceName} (${originalChildModuleName})`;
childNode.contextValue = 'instance';

const targetUri = vscode.Uri.file(instance.instanceFilePath);
const targetSelection = new vscode.Range(instance.instancePosition, instance.instancePosition);

childNode.command = {
command: 'vscode.open',
title: 'Go to Instantiation',
arguments: [targetUri, { selection: targetSelection }]
};
return childNode;
}
return null;
}).filter((n): n is ModuleNode => n !== null);
// 3. 移除了原来在这里的按字母排序 .sort(...)
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
}
return node;
}

// findParentModule 函数保持不变
private findParentModule(position: vscode.Position, symbols: Symbol[]): Symbol | undefined {
const enclosingSymbols = symbols.filter(s => s.endPosition && s.startPosition.isBeforeOrEqual(position) && s.endPosition.isAfterOrEqual(position));
if (enclosingSymbols.length === 0) { return undefined; }
enclosingSymbols.sort((a, b) => (a.endPosition.line - a.startPosition.line) - (b.endPosition.line - b.startPosition.line));
return enclosingSymbols[0];
}
}

// ModuleNode 类保持不变
export class ModuleNode extends vscode.TreeItem {
children: ModuleNode[] = [];
public readonly resourceUri?: vscode.Uri;
constructor(
public readonly moduleName: string,
public readonly info: ModuleInfo,
public readonly collapsibleState: vscode.TreeItemCollapsibleState,
private readonly context: vscode.ExtensionContext
) {
super(moduleName, collapsibleState);

if (info.isMissing) {
this.description = `(primitive or missing)`;
this.tooltip = `Module: ${moduleName}\nStatus: Definition not found in workspace.`;
this.iconPath = { 
light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'file_missing.png'), 
dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'file_missing.png') 
};
this.command = undefined;
this.contextValue = 'missing_module';
} else if (info.symbol) {
this.resourceUri = vscode.Uri.file(info.symbol.path);
this.description = `${path.basename(info.symbol.path)} (${info.symbol.type})`;
this.tooltip = `Module: ${info.symbol.name}\nType: ${info.symbol.type}\nFile: ${info.symbol.path}`;
if (info.symbol.type === 'entity') {
this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.svg'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'vhdl-icon.svg') };
} else {
this.iconPath = { light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.svg'), dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'verilog-icon.svg') };
}
this.command = {
command: 'vscode.open',
title: 'Open Definition',
arguments: [vscode.Uri.file(info.symbol.path), { selection: new vscode.Range(info.symbol.startPosition, info.symbol.startPosition) }]
};
this.contextValue = 'module_with_file';
}
}
}
