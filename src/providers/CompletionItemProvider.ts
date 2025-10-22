// 文件: src/providers/CompletionItemProvider.ts (智能过滤版)

// SPDX-License-Identifier: MIT
import * as vscode from 'vscode';
import { BsvInfoProviderManger } from '../BsvProvider';
import { CtagsManager, Symbol } from '../ctags';
import { Logger } from '../logger';

// ★ 1. 定义列表部分保持不变 ★
// ... (所有关键字、指令、系统函数列表的代码都和您提供的一样，此处省略) ...
const verilogKeywords = [
    'always', 'and', 'assign', 'automatic', 'begin', 'buf', 'bufif0', 'bufif1',
    'case', 'casex', 'casez', 'cell', 'cmos', 'config', 'deassign', 'default',
    'defparam', 'design', 'disable', 'edge', 'else', 'end', 'endcase',
    'endconfig', 'endfunction', 'endgenerate', 'endmodule', 'endprimitive',
    'endspecify', 'endtable', 'endtask', 'event', 'for', 'force', 'forever',
    'fork', 'function', 'generate', 'genvar', 'highz0', 'highz1', 'if',
    'ifnone', 'incdir', 'include', 'initial', 'inout', 'input', 'instance',
    'integer', 'join', 'large', 'liblist', 'library', 'localparam', 'macromodule',
    'medium', 'module', 'nand', 'negedge', 'nmos', 'nor', 'noshowcancelled',
    'not', 'notif0', 'notif1', 'or', 'output', 'parameter', 'pmos', 'posedge',
    'primitive', 'pull0', 'pull1', 'pulldown', 'pullup', 'pulsestyle_onevent',
    'pulsestyle_ondetect', 'rcmos', 'real', 'realtime', 'reg', 'release',
    'repeat', 'rnmos', 'rpmos', 'rtran', 'rtranif0', 'rtranif1', 'scalared',
    'showcancelled', 'signed', 'small', 'specify', 'specparam', 'strong0',
    'strong1', 'supply0', 'supply1', 'table', 'task', 'time', 'tran',
    'tranif0', 'tranif1', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg',
    'unsigned', 'use', 'vectored', 'wait', 'wand', 'weak0', 'weak1', 'while',
    'wire', 'wor', 'xnor', 'xor'
];

const verilogDirectives = [
    'celldefine', 'endcelldefine', 'default_nettype', 'define', 'else', 'elsif',
    'endif', 'ifdef', 'ifndef', 'include', 'line', 'nounconnected_drive',
    'pragma', 'resetall', 'timescale', 'unconnected_drive', 'undef'
];

const verilogSystemFunctions = [
    'display', 'displayb', 'displayh', 'displayo', 'write', 'writeb', 'writeh',
    'writeo', 'strobe', 'strobeb', 'strobeh', 'strobeo', 'monitor', 'monitorb',
    'monitorh', 'monitoro', 'monitoron', 'monitoroff', 'time', 'stime',
    'realtime', 'finish', 'stop', 'readmemh', 'readmemb', 'value$plusargs',
    'random', 'dumpfile', 'dumpvars', 'dumpon', 'dumpoff', 'dumpall',
    'dumpflush', 'dumplimit', 'dumpfile', 'fopen', 'fclose', 'fdisplay',
    'fdisplayb', 'fdisplayh', 'fdisplayo', 'fwrite', 'fwriteb', 'fwriteh',
    'fwriteo', 'fstrobe', 'fstrobeb', 'fstrobeh', 'fstrobeo', 'fmonitor',
    'fmonitorb', 'fmonitorh', 'fmonitoro', 'sformat', 'swrite', 'countdrivers',
    'getpattern', 'incsave', 'restart', 'save', 'scale', 'showscopes',
    'showvars', 'showvariable', 'input', 'key', 'log', 'nolog', 'scope',
    'showports', 'showclass', 'coverage_control', 'coverage_merge',
    'coverage_save'
];

const systemVerilogKeywords = [
    ...verilogKeywords,
    'alias', 'always_comb', 'always_ff', 'always_latch', 'assert', 'assume',
    'before', 'bind', 'bins', 'binsof', 'bit', 'break', 'byte', 'chandle',
    'class', 'clocking', 'const', 'constraint', 'context', 'continue',
    'cover', 'covergroup', 'coverpoint', 'cross', 'dist', 'do', 'endclass',
    'endclocking', 'endgroup', 'endinterface', 'endpackage', 'endprogram',
    'endproperty', 'endsequence', 'enum', 'expect', 'export', 'extends',
    'extern', 'final', 'first_match', 'foreach', 'forkjoin', 'iff', 'ignore_bins',
    'illegal_bins', 'import', 'inside', 'int', 'interface', 'intersect',
    'join_any', 'join_none', 'local', 'logic', 'longint', 'matches', 'modport',
    'new', 'null', 'package', 'packed', 'priority', 'program', 'property',
    'protected', 'pure', 'rand', 'randc', 'randcase', 'randsequence', 'ref',
    'return', 'sequence', 'shortint', 'shortreal', 'solve', 'static', 'string',
    'struct', 'super', 'tagged', 'this', 'throughout', 'timeprecision',
    'timeunit', 'type', 'typedef', 'union', 'unique', 'unique0', 'unsigned',
    'var', 'virtual', 'void', 'wait_order', 'wildcard', 'with', 'within'
];

const systemVerilogSystemFunctions = [
    ...verilogSystemFunctions,
    'fatal', 'error', 'warning', 'info', 'asserton', 'assertoff',
    'assertkill', 'onehot', 'onehot0', 'isunknown', 'countones', 'bits',
    'low', 'high', 'left', 'right', 'size', 'increment', 'dimensions',
    'unpacked_dimensions', 'typeof', 'unit', 'root', 'cast', 'urandom',
    'urandom_range', 'srandom', 'get_randstate', 'set_randstate', 'dist_uniform',
    'dist_normal', 'dist_exponential', 'dist_poisson', 'dist_chi_square',
    'dist_t', 'dist_erlang'
];

const vhdlKeywords = [
    'abs', 'access', 'after', 'alias', 'all', 'and', 'architecture', 'array',
    'assert', 'attribute', 'begin', 'block', 'body', 'buffer', 'bus', 'case',
    'component', 'configuration', 'constant', 'disconnect', 'downto', 'else',
    'elsif', 'end', 'entity', 'exit', 'file', 'for', 'function', 'generate',
    'generic', 'group', 'guarded', 'if', 'impure', 'in', 'inertial', 'inout',
    'is', 'label', 'library', 'linkage', 'literal', 'loop', 'map', 'mod',
    'nand', 'new', 'next', 'nor', 'not', 'null', 'of', 'on', 'open', 'or',
    'others', 'out', 'package', 'port', 'postponed', 'procedure', 'process',
    'pure', 'range', 'record', 'register', 'reject', 'rem', 'report',
    'return', 'rol', 'ror', 'select', 'severity', 'signal', 'shared', 'sla',
    'sll', 'sra', 'srl', 'subtype', 'then', 'to', 'transport', 'type',
    'unaffected', 'units', 'until', 'use', 'variable', 'wait', 'when',
    'while', 'with', 'xnor', 'xor'
];

// ★ 2. 重构 VerilogCompletionItemProvider ★
// =========================================================

export class VerilogCompletionItemProvider implements vscode.CompletionItemProvider {
  private logger: Logger;
  private ctagsManager: CtagsManager;
  constructor(logger: Logger,
    ctagsManager: CtagsManager){
    this.logger = logger;
    this.ctagsManager = ctagsManager;
  }

  // ★★★ 重构的核心在此方法 ★★★
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    
    // 获取光标前的一个词的范围，用于后续的替换
    const wordRange = document.getWordRangeAtPosition(position, /[`$]?\w+/);
    // 获取光标前输入的文本（前缀）
    const prefix = wordRange ? document.getText(wordRange) : '';

    this.logger.info(`Completion requested. Prefix: "${prefix}", Trigger: "${context.triggerCharacter}"`);

    // 如果是 VHDL，单独处理，逻辑简单
    if (document.languageId === 'vhdl') {
        return vhdlKeywords.map(keyword => {
            const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
            item.detail = 'Keyword';
            return item;
        });
    }

    let completionItems: vscode.CompletionItem[] = [];
    
    // 根据触发字符或前缀来决定提供什么补全项
    const triggerChar = context.triggerCharacter;

    // 情况1：由 ` 触发，或前缀以 ` 开头
    if (triggerChar === '`' || prefix.startsWith('`')) {
        this.logger.info('Providing compiler directives.');
        const directives = verilogDirectives; // SV 和 V 的指令集相同
        directives.forEach(directive => {
            const item = new vscode.CompletionItem(`\`${directive}`, vscode.CompletionItemKind.Value);
            item.detail = 'Compiler Directive';
            item.insertText = `\`${directive} `;
            // 设置替换范围，确保 ` 也能被正确替换
            item.range = wordRange; 
            completionItems.push(item);
        });
        return completionItems;
    }

    // 情况2：由 $ 触发，或前缀以 $ 开头
    if (triggerChar === '$' || prefix.startsWith('$')) {
        this.logger.info('Providing system tasks/functions.');
        let systemFunctions: string[] = [];
        if (document.languageId === 'systemverilog') {
            systemFunctions = [...new Set(systemVerilogSystemFunctions)];
        } else {
            systemFunctions = verilogSystemFunctions;
        }

        systemFunctions.forEach(func => {
            const item = new vscode.CompletionItem(`$${func}`, vscode.CompletionItemKind.Function);
            item.detail = 'System Task/Function';
            // 使用 SnippetString 插入文本
            item.insertText = new vscode.SnippetString(`\\$${func}(\${1})`);
            // ★ 关键：这里的 label 是 `$func`，而插入文本是 `func()`
            // 我们需要告诉 VS Code，需要替换掉用户已经输入的 `$`
            if (wordRange) {
              // 从 wordRange 的起始位置（包含`$`）开始替换
              item.range = wordRange;
            } else {
              // 如果没有 wordRange，就从当前位置的前一个字符开始替换
              item.range = new vscode.Range(position.translate(0, -1), position);
            }
            completionItems.push(item);
        });
        return completionItems;
    }
    
    // 情况3：普通输入（非触发字符），提供关键字和 Ctags 符号
    this.logger.info('Providing keywords and ctags symbols.');
    // 添加关键字
    let keywords: string[] = [];
    if (document.languageId === 'systemverilog') {
        keywords = [...new Set(systemVerilogKeywords)];
    } else {
        keywords = verilogKeywords;
    }
    keywords.forEach(keyword => {
        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
        item.detail = 'Keyword';
        completionItems.push(item);
    });

    // 添加 Ctags 符号
    try {
        const symbols: Symbol[] = await this.ctagsManager.getSymbols(document);
        symbols.forEach((symbol) => {
            let newItem = new vscode.CompletionItem(symbol.name, this.getCompletionItemKind(symbol.type));
            newItem.detail = `${symbol.type} (symbol)`;
            // (文档化部分的代码可以保持不变，此处简化)
            completionItems.push(newItem);
        });
    } catch(e) {
        this.logger.error('Failed to get symbols from ctagsManager', e);
    }
    
    this.logger.info(`${completionItems.length} completion items returned for general input.`);
    // VS Code 会自动根据 prefix 过滤这个列表
    return completionItems;
  }

  private getCompletionItemKind(type: string): vscode.CompletionItemKind {
    // 保持不变
    switch (type) {
      case 'constant': return vscode.CompletionItemKind.Constant;
      case 'event': return vscode.CompletionItemKind.Event;
      case 'function': return vscode.CompletionItemKind.Function;
      case 'module': return vscode.CompletionItemKind.Module;
      case 'net': return vscode.CompletionItemKind.Variable;
      case 'port': return vscode.CompletionItemKind.Interface;
      case 'register': return vscode.CompletionItemKind.Variable;
      case 'task': return vscode.CompletionItemKind.Function;
      case 'block': return vscode.CompletionItemKind.Module;
      case 'assert': return vscode.CompletionItemKind.Variable;
      case 'class': return vscode.CompletionItemKind.Class;
      case 'covergroup': return vscode.CompletionItemKind.Class;
      case 'enum': return vscode.CompletionItemKind.Enum;
      case 'interface': return vscode.CompletionItemKind.Interface;
      case 'modport': return vscode.CompletionItemKind.Variable;
      case 'package': return vscode.CompletionItemKind.Module;
      case 'program': return vscode.CompletionItemKind.Module;
      case 'prototype': return vscode.CompletionItemKind.Function;
      case 'property': return vscode.CompletionItemKind.Property;
      case 'struct': return vscode.CompletionItemKind.Struct;
      case 'typedef': return vscode.CompletionItemKind.TypeParameter;
      default: return vscode.CompletionItemKind.Variable;
    }
  }
}
// BsvCompletionItemProvider (保持不变)
export class BsvCompletionItemProvider implements vscode.CompletionItemProvider {
  private logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
    const provider = BsvInfoProviderManger.getInstance().getProvider();
    return provider.lint(document, position);
  }
}
