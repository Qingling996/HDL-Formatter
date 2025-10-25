import * as vscode from 'vscode';
import { AstNode, CommentNode } from './ast-types';

// =========================================================================
// 1. 配置管理类 (无变化)
// =========================================================================
class FormatterConfig {
    // Port Declarations
    public readonly port_num2: number;
    public readonly port_num3: number;
    public readonly port_num4: number;
    public readonly port_num5: number;

    // Signal Declarations
    public readonly signal_num2: number;
    public readonly signal_num3: number;
    public readonly signal_num4: number;
    public readonly signal_num5: number;

    // Parameter Declarations
    public readonly param_num2: number;
    public readonly param_num3: number;
    public readonly param_num4: number;

    // Module Instantiation
    public readonly inst_num2: number;
    public readonly inst_num3: number;

    // Continuous Assignments
    public readonly assign_num2: number;
    public readonly assign_num3: number;
    public readonly assign_num4: number;

    // Procedural Blocks (always, initial)
    public readonly always_rvalue_align: number;
    public readonly always_op_align: number;
    public readonly always_comment_align: number;

    public readonly case_colon_align: number;//对齐case中冒号所在位置
    public readonly case_stmt_align: number; // 用于对齐 case 执行语句

    // Miscellaneous
    public readonly upbound: number;
    public readonly lowbound: number;

    constructor(config: vscode.WorkspaceConfiguration) {
        this.port_num2 = config.get<number>('port_num2', 16);
        this.port_num3 = config.get<number>('port_num3', 24);
        this.port_num4 = config.get<number>('port_num4', 48);
        this.port_num5 = config.get<number>('port_num5', 80);

        this.signal_num2 = config.get<number>('signal_num2', 16);
        this.signal_num3 = config.get<number>('signal_num3', 24);
        this.signal_num4 = config.get<number>('signal_num4', 48);
        this.signal_num5 = config.get<number>('signal_num5', 80);

        this.param_num2 = config.get<number>('param_num2', 24);
        this.param_num3 = config.get<number>('param_num3', 48);
        this.param_num4 = config.get<number>('param_num4', 80);

        this.inst_num2 = config.get<number>('inst_num2', 40);
        this.inst_num3 = config.get<number>('inst_num3', 80);

        this.assign_num2 = config.get<number>('assign_num2', 20);
        this.assign_num3 = config.get<number>('assign_num3', 48);
        this.assign_num4 = config.get<number>('assign_num4', 80);

        this.always_op_align = config.get<number>('always_op_align', 32);
        this.always_rvalue_align = config.get<number>('always_rvalue_align', 4);
        this.always_comment_align = config.get<number>('always_comment_align', 80);

        this.case_colon_align = config.get<number>('case_colon_align', 20);
        this.case_stmt_align = config.get<number>('case_stmt_align', 28); 

        this.upbound = config.get<number>('upbound', 3);
        this.lowbound = config.get<number>('lowbound', 3);
    }
}

// =========================================================================
// 2. 主格式化逻辑
// =========================================================================

export function generateVerilogFromAST(ast: AstNode, config: vscode.WorkspaceConfiguration): string {
    const formatterConfig = new FormatterConfig(config);
    let output = '';
    let indentLevel = 0;
    const indentChar = '    ';

    function getIndent(): string {
        return indentChar.repeat(indentLevel);
    }
    
    function processTrailingComment(node: AstNode, alignColumn: number) {
        if (node.trailingComments && node.trailingComments.length > 0) {
            output = output.trimEnd();
            const currentLineLength = output.length - output.lastIndexOf('\n') - 1;
            const padding = ' '.repeat(Math.max(1, alignColumn - 1 - currentLineLength));
            output += padding + node.trailingComments[0].text.trim();
            node.trailingComments = [];
        }
    }

    function processLeadingComments(node: AstNode) {
        if (node.leadingComments) {
            node.leadingComments.forEach(comment => {
                output += getIndent() + comment.text + '\n';
            });
        }
    }

    function printAndStealMisplacedComment(blockNode: AstNode | undefined) {
        if (!blockNode) return;
        const innerStatement = blockNode.children?.find((c: AstNode) => c.name === 'statement');
        if (!innerStatement) return;

        let commentHolderNode: AstNode | undefined = undefined;

        if (innerStatement.leadingComments && innerStatement.leadingComments.length > 0) {
            commentHolderNode = innerStatement;
        }
        else if (innerStatement.children?.[0]?.leadingComments && innerStatement.children[0].leadingComments.length > 0) {
            commentHolderNode = innerStatement.children[0];
        }

        if (commentHolderNode && commentHolderNode.leadingComments) {
            const comment = commentHolderNode.leadingComments.shift()!;
            output = output.trimEnd();
            const currentLineLength = output.length - output.lastIndexOf('\n') - 1;
            const padding = ' '.repeat(Math.max(1, formatterConfig.always_comment_align - 1 - currentLineLength));
            output += padding + comment.text.trim();
        }
    }

    function reconstructText(node: AstNode | undefined): string {
        if (!node) return '';
        if (node.value) return node.value;
        if (node.children) {
            if (node.name === 'range_expression') {
                const parts = node.children
                    .filter(c => c.name !== 'LBRACK' && c.name !== 'RBRACK' && c.name !== 'COLON');
                
                if (parts.length === 2) {
                    const msb = reconstructText(parts[0]);
                    const lsb = reconstructText(parts[1]);
                    const paddedMsb = msb.padEnd(formatterConfig.upbound);
                    const paddedLsb = lsb.padStart(formatterConfig.lowbound);
                    return `[${paddedMsb}:${paddedLsb}]`;
                } else {
                    // Fallback for single-value ranges like [WIDTH]
                    const singleVal = parts.map(reconstructText).join('');
                    return `[${singleVal}]`;
                }
            }
            if (node.name === 'function_call') {
                const funcName = reconstructText(node.children?.find(c => c.name.endsWith('_identifier')));
                const lparenIndex = node.children?.findIndex(c => c.name === 'LPAREN') ?? -1;
                const rparenIndex = node.children?.findIndex(c => c.name === 'RPAREN') ?? -1;

                let args = '';
                if (lparenIndex !== -1 && rparenIndex !== -1 && lparenIndex < rparenIndex) {
                    const argNodes = node.children?.slice(lparenIndex + 1, rparenIndex)
                        .filter(c => c.name !== 'COMMA') || [];
                    args = argNodes.map(reconstructText).join(', ');
                }
                return `${funcName}(${args})`;
            }
            const tightExpressions = [
                'unary_expression', 'equality_expression', 'additive_expression',
                'multiplicative_expression', 'shift_expression', 'relational_expression',
                'named_parameter_assignment', 'named_port_connection',
                'system_call',
                'event_control',
                'variable_decl_assignment',
                'variable_lvalue'
            ];
            if (tightExpressions.includes(node.name) || node.name.endsWith('_identifier')) {
                return node.children.map(reconstructText).join('');
            }
            return node.children.map(reconstructText).join(' ');
        }
        return '';
    }

    function formatAnsiPortDeclaration(node: AstNode): string {
        const indentStr = getIndent();
        const dirNode = node.children?.find(c => c.name === 'port_direction');
        const typeNode = node.children?.find(c => c.name === 'net_or_reg_type' || c.name === 'REG');
        const signedNode = node.children?.find(c => c.name === 'SIGNED');
        const rangeNode = node.children?.find(c => c.name === 'range_expression');
        const varNode = node.children?.find(c => c.name === 'variable_with_dimensions');
        const idNode = varNode?.children?.find(c => c.name === 'IDENTIFIER');
        const directionPart = dirNode ? reconstructText(dirNode) : '';
        const typePart = typeNode ? reconstructText(typeNode) : '';
        const signedPart = signedNode ? reconstructText(signedNode) : '';
        const namePart = idNode ? reconstructText(idNode) : '';
        const widthPart = rangeNode ? reconstructText(rangeNode) : '';
        const dirAndType = [directionPart, typePart].filter(Boolean).join(' ');
        
        let line = indentStr + dirAndType;
        line = line.padEnd(formatterConfig.port_num2 - 1) + ' ' + (signedPart || '');
        line = line.padEnd(formatterConfig.port_num3 - 1) + ' ' + (widthPart || '');
        line = line.padEnd(formatterConfig.port_num4 - 1) + ' ' + (namePart || '');
        
        return line.trimEnd();
    }

    function formatNonAnsiPortDeclaration(node: AstNode): string {
        const indentStr = getIndent();
        const dirNode = node.children?.find(c => c.name === 'INPUT' || c.name === 'OUTPUT' || c.name === 'INOUT');
        const typeNode = node.children?.find(c => c.name === 'net_or_reg_type');
        const signedNode = node.children?.find(c => c.name === 'SIGNED');
        const rangeNode = node.children?.find(c => c.name === 'range_expression');
        const nameNode = node.children?.find(c => c.name === 'variable_decl_assignment');

        const directionPart = dirNode ? reconstructText(dirNode) : '';
        const typePart = typeNode ? reconstructText(typeNode) : '';
        const signedPart = signedNode ? reconstructText(signedNode) : '';
        const namePart = nameNode ? reconstructText(nameNode) : '';
        const widthPart = rangeNode ? reconstructText(rangeNode) : '';
        
        const dirAndType = [directionPart, typePart].filter(Boolean).join(' ');

        let line = indentStr + dirAndType;
        line = line.padEnd(formatterConfig.port_num2 - 1) + ' ' + (signedPart || '');
        line = line.padEnd(formatterConfig.port_num3 - 1) + ' ' + (widthPart || '');
        line = line.padEnd(formatterConfig.port_num4 - 1) + ' ' + (namePart || '');
        
        return line.trimEnd();
    }
    
    function formatSignalDeclaration(node: AstNode): string {
        const indentStr = getIndent();
        const typeNode = node.children?.[0];
        const signedNode = node.children?.find(c => c.name === 'SIGNED');
        const widthRangeNode = node.children?.find(c => c.name === 'range_expression');

        const nameNodes = node.children?.filter(c => 
            c.name === 'variable_decl_assignment' || 
            (c.name === 'IDENTIFIER' && c !== typeNode)
        ) || [];

        const typePart = typeNode ? reconstructText(typeNode) : '';
        const signedPart = signedNode ? reconstructText(signedNode) : '';
        const widthPart = widthRangeNode ? reconstructText(widthRangeNode) : '';
        const namePart = nameNodes.map(reconstructText).join(', ');

        let line = indentStr + typePart;
        line = line.padEnd(formatterConfig.signal_num2 - 1) + ' ' + (signedPart || '');
        line = line.padEnd(formatterConfig.signal_num3 - 1) + ' ' + (widthPart || '');
        line = line.padEnd(formatterConfig.signal_num4 - 1) + ' ' + (namePart || '');
        
        return line.trimEnd();
    }

    function formatAnyParameter(node: AstNode): string {
        const indentStr = getIndent();
        
        const aNode = node.name === 'internal_param_assignment' ? node : node.children?.find(c => c.name === 'internal_param_assignment') || node;

        const keywordNode = node.children?.find(c => c.name === 'PARAMETER' || c.name === 'LOCALPARAM');
        const nameNode = aNode.children?.find(c => c.name === 'IDENTIFIER');
        const assignEqIndex = aNode.children?.findIndex(c => c.name === 'ASSIGN_EQ') ?? -1;

        let valuePart = '';
        if (assignEqIndex !== -1 && aNode.children && assignEqIndex + 1 < aNode.children.length) {
            const valueNodes = aNode.children.slice(assignEqIndex + 1);
            valuePart = valueNodes.map(reconstructText).join(' ');
        }
        
        const keywordPart = keywordNode ? reconstructText(keywordNode) : 'parameter';
        const namePart = nameNode ? reconstructText(nameNode) : '';
        
        let line = indentStr + keywordPart;
        line = line.padEnd(formatterConfig.param_num2 - 1) + ' ' + namePart;
        line = line.padEnd(formatterConfig.param_num3 - 1) + ' = ' + valuePart;

        return line.trimEnd();
    }

    function formatContinuousAssign(node: AstNode): string {
        const indentStr = getIndent();
        
        const assignEqIndex = node.children?.findIndex(c => c.name === 'ASSIGN_EQ') ?? -1;
        let lvalueNode: AstNode | undefined;
        let rvalueNodes: AstNode[] = [];

        if (assignEqIndex > 0 && node.children) {
            lvalueNode = node.children[assignEqIndex - 1];
            rvalueNodes = node.children.slice(assignEqIndex + 1);
        }

        const lvaluePart = lvalueNode ? reconstructText(lvalueNode) : '';
        const rvaluePart = rvalueNodes.map(reconstructText).join(' ');

        let line = indentStr + 'assign';
        line = line.padEnd(formatterConfig.assign_num2 - 1) + ' ' + lvaluePart;
        line = line.padEnd(formatterConfig.assign_num3 - 1) + ' = ' + rvaluePart;
        
        return line.trimEnd();
    }
    
    function formatNamedPortConnection(node: AstNode): string {
        const indentStr = getIndent();
        const lparenIndex = node.children?.findIndex(c => c.name === 'LPAREN') ?? -1;
        const rparenIndex = node.children?.findIndex(c => c.name === 'RPAREN') ?? -1;
        
        let portNamePart = '';
        let signalPart = '';
        
        if (lparenIndex !== -1 && rparenIndex !== -1 && node.children) {
            const portNameNodes = node.children.slice(0, lparenIndex);
            portNamePart = portNameNodes.map(reconstructText).join('');
            
            const signalNodes = node.children.slice(lparenIndex + 1, rparenIndex);
            signalPart = signalNodes.map(reconstructText).join('');
        } else {
            return indentStr + reconstructText(node);
        }

        let line = indentStr + portNamePart;
        line = line.padEnd(formatterConfig.inst_num2 - 1) + ' (' + signalPart;
        line = line.padEnd(formatterConfig.inst_num3) + ')';
        
        return line;
    }

    function processNodeList(
        nodes: AstNode[], 
        options: { 
            itemFormatter?: (node: AstNode) => string,
            alignColumn?: number 
        } = {}
    ) {
        for (let i = 0; i < nodes.length; i++) {
            const currentNode = nodes[i];
            const nextNode = (i + 1 < nodes.length) ? nodes[i + 1] : null;
            const isLastNode = (i === nodes.length - 1);

            processLeadingComments(currentNode);

            let lineContent = '';
            if (options.itemFormatter) {
                lineContent = options.itemFormatter(currentNode);
            } else {
                lineContent = getIndent() + reconstructText(currentNode).replace(/\s+/g, ' ');
            }
            
            output += lineContent;
            
            if (!isLastNode) {
                if (options.alignColumn) {
                    const currentLineLength = lineContent.length;
                    const padding = ' '.repeat(Math.max(0, options.alignColumn - 1 - currentLineLength));
                    output += padding;
                }
                output += ',';
            }

            const currentLineLengthAfterComma = output.length - output.lastIndexOf('\n') - 1;
            const commentAlignColumn = (options.alignColumn ?? currentLineLengthAfterComma) + 2;
            
            const commentsToSteal: CommentNode[] = [];
            if (nextNode && nextNode.leadingComments) {
                while (nextNode.leadingComments.length > 0 && nextNode.leadingComments[0].text.startsWith('//')) {
                    commentsToSteal.push(nextNode.leadingComments.shift()!);
                }
            }

            if (commentsToSteal.length > 0) {
                output = output.trimEnd();
                const currentLen = output.length - output.lastIndexOf('\n') - 1;
                const padding = ' '.repeat(Math.max(1, commentAlignColumn - 1 - currentLen));
                output += padding + commentsToSteal.map(c => c.text.trim()).join(' ');
            }

            processTrailingComment(currentNode, commentAlignColumn);
            output += '\n';
        }
    }

    function processNode(node: AstNode, skipComments = false, skipIndent = false, prefix = '') {
        if (!node || !node.name) return;

        if (!skipComments) {
            processLeadingComments(node);
        }
        const indent = prefix ? '' : (skipIndent ? '' : getIndent());
        
        switch (node.name) {
            case 'source_text':
                node.children?.forEach(child => processNode(child));
                break;
            case '<EOF>':
                break;
            case 'compiler_directive':
                output += (node.value || '') + '\n';
                break;
            case 'module_declaration': {
                const moduleName = node.children?.find(c => c.name === 'IDENTIFIER')?.value || 'unknown';
                output += `\n${indent}module ${moduleName}`;

                const paramList = node.children?.find(c => c.name === 'parameter_port_list');
                if (paramList) {
                    output += ` #(\n`;
                    indentLevel++;
                    const params = paramList.children?.filter(c => c.name === 'port_param_assignment') || [];
                    processNodeList(params, { 
                        itemFormatter: formatAnyParameter,
                        alignColumn: formatterConfig.param_num4 + 1
                    });
                    indentLevel--;
                    output += `${getIndent()})`;
                }

                const portList = node.children?.find(c => c.name === 'list_of_ports');
                const firstPortNode = portList?.children?.find(c => c.name.includes('port') || c.name.includes('variable'));
                const isAnsiStyle = firstPortNode?.name === 'port_declaration';

                if (portList) {
                    output += ` (\n`;
                    indentLevel++;
                    const ports = portList.children?.filter(c => c.name === 'port_declaration' || c.name === 'variable_with_dimensions') || [];
                    if (isAnsiStyle) {
                        processNodeList(ports, { itemFormatter: formatAnsiPortDeclaration, alignColumn: formatterConfig.port_num5 + 1});
                    } else {
                        processNodeList(ports, { 
                            itemFormatter: (n) => (getIndent() + reconstructText(n)),
                            alignColumn: formatterConfig.port_num4 + 1
                        });
                    }
                    indentLevel--;
                    output += `${getIndent()});\n`;
                } else {
                    output += ';\n';
                }

                indentLevel++;
                const moduleItems = node.children?.filter(c => c.name.endsWith('_declaration') || c.name.endsWith('_construct') || c.name === 'continuous_assign' || c.name === 'module_instantiation' || c.name === 'gate_instantiation' || c.name === 'generate_block') || [];
                
                if (moduleItems.length > 0) output += '\n';

                moduleItems.forEach(child => {
                    if (!isAnsiStyle && child.name.endsWith('_port_declaration')) {
                        processLeadingComments(child);
                        let line = formatNonAnsiPortDeclaration(child);
                        line = line.padEnd(formatterConfig.port_num5) + ';';
                        output += line;
                        processTrailingComment(child, formatterConfig.port_num5 + 2);
                        output += '\n';
                    } else {
                        processNode(child);
                    }
                });
                
                indentLevel--;
                output += `\n${indent}endmodule\n`;
                break;
            }
            case 'module_instantiation': {
                const moduleType = node.children?.find(c => c.name === 'IDENTIFIER')?.value || 'unknown_module';
                output += `\n${indent}${moduleType}`;
                const hasParams = node.children?.some(c => c.name === 'HASH');
                if (hasParams) {
                    let params: AstNode[] = [];
                    const paramListNode = node.children?.find(c => c.name === 'list_of_named_param_assignments');
                    if (paramListNode) {
                        params = paramListNode.children?.filter(c => c.name === 'named_parameter_assignment') || [];
                    } else {
                        params = node.children?.filter(c => c.name === 'named_parameter_assignment') || [];
                    }
                    if (params.length > 0) {
                        output += ` #(\n`;
                        indentLevel++;
                        processNodeList(params, {
                            itemFormatter: formatNamedPortConnection,
                            alignColumn: formatterConfig.inst_num3
                        });
                        indentLevel--;
                        output += `${getIndent()})`;
                    } else {
                        output += ` #()`;
                    }
                }
                const instanceNode = node.children?.find(c => c.name === 'module_instance');
                if (instanceNode) {
                    const instanceNameNode = instanceNode.children?.find(c => c.name === 'name_of_instance');
                    if (instanceNameNode) {
                        output += ` ${reconstructText(instanceNameNode)}`;
                    }
                    const portList = instanceNode.children?.find(c => c.name === 'list_of_port_connections');
                    if (portList) {
                        output += ` (\n`;
                        indentLevel++;
                        const ports = portList.children?.filter(c => c.name === 'named_port_connection') || [];
                        processNodeList(ports, {
                            itemFormatter: formatNamedPortConnection,
                            alignColumn: formatterConfig.inst_num3
                        });
                        indentLevel--;
                        output += `${getIndent()})`;
                    } else {
                        output += ` ()`;
                    }
                }
                output += ';\n';
                break;
            }
            case 'function_declaration': {
                const children = node.children || [];
                const funcNameNode = children.find(c => c.name === 'IDENTIFIER');
                const funcName = funcNameNode?.value || 'unknown_function';

                // Find all parts of the return type declaration using anchors
                const funcNameIndex = funcNameNode ? children.indexOf(funcNameNode) : -1;
                const functionKeywordIndex = children.findIndex(c => c.name === 'FUNCTION');

                let returnTypeParts: string[] = [];
                if (funcNameIndex > functionKeywordIndex) {
                    const typeNodes = children.slice(functionKeywordIndex + 1, funcNameIndex);
                    returnTypeParts = typeNodes.map(reconstructText);
                }

                const returnTypeStr = returnTypeParts.length > 0 ? ` ${returnTypeParts.join(' ')}` : '';

                output += `\n${indent}function${returnTypeStr} ${funcName};`;
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';

                indentLevel++;
                const funcItems = children.filter(
                c => c.name === 'function_item_declaration' || c.name === 'statement'
                );
                for (const item of funcItems) {
                    processNode(item);
                }
                indentLevel--;

                output += `${indent}endfunction\n`;
                break;
            }
            case 'task_declaration': {
                const taskName = node.children?.find(c => c.name === 'IDENTIFIER')?.value || 'unknown_task';
                const isAutomatic = node.children?.some(c => c.name === 'AUTOMATIC');

                output += `\n${indent}task${isAutomatic ? ' automatic' : ''} ${taskName};`;

                // 正常处理 task 声明行自身的行尾注释
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';

                // ★★★ 防御性代码: 检查并移除被错误归类的注释 ★★★
                const firstStatement = node.children?.find(c => c.name === 'statement');
                if (firstStatement?.leadingComments && firstStatement.leadingComments.length > 0) {
                    // 如果 task 声明行有行尾注释 (我们刚刚处理过), 
                    // 那么 statement 上的这个前导注释就是重复的, 将其清空.
                    if (node.trailingComments && node.trailingComments.length > 0) {
                         // `processTrailingComment` 已经将其设置为空数组, 这里我们确保万无一失
                    } else {
                        // 如果 task 声明行本身没有行尾注释, 那么这个注释可能是正确的, 只是位置错了
                        // 但为了解决重复打印的问题, 我们在这里消耗掉它, 避免下面再次打印
                        // (这种情况理论上不应发生, 但作为防御代码是安全的)
                    }
                    // 核心修复: 无论如何, 清空它, 避免被 processNode 再次打印
                    firstStatement.leadingComments = [];
                }

                indentLevel++;
                const taskItems = node.children?.filter(
                    c => c.name === 'task_item_declaration' || c.name === 'statement'
                ) || [];

                for (let i = 0; i < taskItems.length; i++) {
                    const currentItem = taskItems[i];
                    // 正常处理 task 内部的语句
                    processNode(currentItem, false, false);
                }
                indentLevel--;

                output += `${indent}endtask\n`;
                break;
            }
            case 'task_item_declaration': case 'function_item_declaration': {
                output += indent + reconstructText(node).replace(/\s+/g, ' ');
                const semiNode = node.children?.find(c => c.name === 'SEMI');
                if (semiNode) {
                    processTrailingComment(semiNode, formatterConfig.always_comment_align);
                } else {
                    processTrailingComment(node, formatterConfig.always_comment_align);
                }
                output += '\n';
                break;
            }
            case 'gate_instantiation': {
                let line = reconstructText(node).replace(/\s+/g, ' ');
                line = line.replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')');
                output += indent + line;
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';
                break;
            }
            case 'parameter_declaration':
            case 'localparam_declaration': {
                const lineContent = formatAnyParameter(node);
                output += lineContent;

                const currentLineLength = output.length - output.lastIndexOf('\n') - 1;
                const padding = ' '.repeat(Math.max(0, formatterConfig.param_num4 - currentLineLength));
                output += padding + ';';

                const commentAlignColumn = formatterConfig.param_num4 + 2;
                processTrailingComment(node, commentAlignColumn);
                output += '\n';
                break;
            }
            case 'reg_declaration':
            case 'wire_declaration':
            case 'integer_declaration':
            case 'real_declaration':
            case 'genvar_declaration': {
                const lineContent = formatSignalDeclaration(node);
                output += lineContent;

                const currentLineLength = output.length - output.lastIndexOf('\n') - 1;
                const padding = ' '.repeat(Math.max(0, formatterConfig.signal_num5 - currentLineLength));
                output += padding + ';';

                const commentAlignColumn = formatterConfig.signal_num5 + 2;
                processTrailingComment(node, commentAlignColumn);
                output += '\n';
                break;
            }
            case 'continuous_assign': {
                const lineContent = formatContinuousAssign(node);
                output += lineContent;

                const currentLineLength = output.length - output.lastIndexOf('\n') - 1;
                const padding = ' '.repeat(Math.max(0, formatterConfig.assign_num4 - currentLineLength));
                output += padding + ';';

                const commentAlignColumn = formatterConfig.assign_num4 + 2;
                processTrailingComment(node, commentAlignColumn);
                output += '\n';
                break;
            }
            case 'input_port_declaration':
            case 'output_port_declaration':
            case 'inout_port_declaration':
                // Handled in module_declaration
                break;
            case 'port_param_assignment':
            case 'port_declaration':
            case 'variable_with_dimensions':
                output += getIndent() + reconstructText(node).replace(/\s+/g, ' ');
                break;
            case 'always_construct': {
                const eventControl = node.children?.find(c => c.name === 'event_control');
                const statement = node.children?.find(c => c.name === 'statement');

                if (eventControl) {
                    const sensitivityListNodes = eventControl.children?.filter(c =>
                        c.name !== 'AT' && c.name !== 'LPAREN' && c.name !== 'RPAREN'
                    ) || [];
                    const sensitivityListText = sensitivityListNodes.map(reconstructText).join(' or ');
                    output += `\n${indent}always @(${sensitivityListText})`;
                    if (statement) {
                        processNode(statement, true);
                    }
                } else {
                    output += `\n${indent}always`;
                    if (statement) {
                        if (statement.children?.[0]?.name === 'BEGIN') {
                            processNode(statement, true);
                        } else {
                            output += ' ' + reconstructText(statement).replace(/\s+/g, ' ');
                            processTrailingComment(statement, formatterConfig.always_comment_align);
                            output += '\n';
                        }
                    }
                }
                break;
            }
            case 'initial_construct': {
                output += `\n${indent}initial`;
                const statement = node.children?.find(c => c.name === 'statement');
                if (statement) {
                    if (statement.children?.[0]?.name === 'BEGIN') {
                        processNode(statement, true);
                    } else {
                        output += ' ' + reconstructText(statement).replace(/\s+/g, ' ');
                        processTrailingComment(statement, formatterConfig.always_comment_align);
                        output += '\n';
                    }
                }
                break;
            }
            case 'statement': {
                const children = node.children || [];
                const firstChild = children[0];
                if (!firstChild) break;

                if (firstChild.name === 'BEGIN') {
                    if (output.endsWith('\n') || output === '') {
                        output += `${indent}begin`;
                    } else {
                        output += ` begin`;
                    }

                    printAndStealMisplacedComment(node);
                    output += `\n`;
                    indentLevel++;
                    const innerStatements = children.filter(c => c.name === 'statement');
                    innerStatements.forEach(child => processNode(child));
                    indentLevel--;
                    output += `${getIndent()}end`;
                    processTrailingComment(node, formatterConfig.always_comment_align);
                    output += `\n`;
                    break;
                }

                if (firstChild.name === 'IF') {
                    output += `${indent}if(${reconstructText(children[2])})`;
                    const thenStatement = children[4];
                    processNode(thenStatement, true);
                    const elseIndex = children.findIndex(c => c.name === 'ELSE');
                    if (elseIndex > -1) {
                        output = output.trimEnd();
                        output += `\n${getIndent()}else`;
                        const elseStatement = children[elseIndex + 1];
                        if (elseStatement.children?.[0]?.name === 'IF') {
                            output += ' ';
                            processNode(elseStatement, true, true);
                        } else {
                            processNode(elseStatement, true);
                        }
                    }
                    break;
                }

                if (firstChild.name === 'FOR') {
                    const initializationNode = children[2];
                    const conditionNode = children[4];
                    const stepNode = children[6];
                    const bodyStatementNode = children[8];
                    const init = reconstructText(initializationNode).replace(/\s+/g, ' ');
                    const cond = reconstructText(conditionNode).replace(/\s+/g, ' ');
                    const step = reconstructText(stepNode).replace(/\s+/g, ' ');
                    output += `${indent}for(${init}; ${cond}; ${step})`;
                    if (bodyStatementNode) {
                        processNode(bodyStatementNode, true);
                    }
                    break;
                }

                if (firstChild.name === 'REPEAT') {
                    const countNode = children[2];
                    const bodyStatementNode = children[4];
                    output += `${indent}repeat(${reconstructText(countNode)})`;
                    if (bodyStatementNode) {
                        processNode(bodyStatementNode, true);
                    }
                    break;
                }

                if (['CASE', 'CASEX', 'CASEZ'].includes(firstChild.name)) {
                    output += `${indent}${firstChild.value} (${reconstructText(children[2])})\n`;
                    indentLevel++;
                    children.filter(c => c.name === 'case_item').forEach(item => processNode(item));
                    indentLevel--;
                    output += `${indent}endcase`;
                    processTrailingComment(node, formatterConfig.always_comment_align);
                    output += `\n`;
                    break;
                }

                processNode(firstChild, true, skipIndent, prefix);
                output = output.trimEnd();
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';

                break;
            }
            case 'blocking_or_nonblocking_assignment': {
                let line = prefix + indent;

                if (prefix) {
                    // In a 'case' statement, no special alignment
                    line += reconstructText(node);
                } else {
                    // In an 'always' block, apply the new alignment rules
                    const children = node.children || [];
                    const lvalueNode = children.find(c => c.name.endsWith('_lvalue'));
                    const opNode = children.find(c => c.name === 'ASSIGN_EQ' || c.name === 'LTE' || c.name === 'LE_OP');
                    const opIndex = opNode ? children.indexOf(opNode) : -1;

                    let rvalueText = '';
                    if (opIndex !== -1) {
                        // Robustly get rvalue: everything after the operator
                        const rvalueNodes = children.slice(opIndex + 1);
                        if (rvalueNodes.length > 0) {
                        const tempContainer = { name: 'temp_rvalue_container', children: rvalueNodes };
                        rvalueText = reconstructText(tempContainer);
                    }
                }

                if (lvalueNode && opNode && rvalueText) {
                    const lvalueText = reconstructText(lvalueNode);
                    const opText = reconstructText(opNode);

                    line += lvalueText;
                    // Correctly pad to the column *before* the operator, then add a space and the operator
                    line = line.padEnd(formatterConfig.always_op_align - 1);
                    line += ` ${opText}`;

                    line += ' '.repeat(formatterConfig.always_rvalue_align);
                    line += rvalueText;
                } else {
                    // Fallback if parts can't be robustly found
                    line += reconstructText(node);
                }
                }

                output += line.trimEnd() + ';';
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';
                break;
            }
            case 'case_item': {
                const children = node.children || [];
                const colonIndex = children.findIndex(c => c.name === 'COLON');
                
                const conditionNodes = (colonIndex !== -1 ? children.slice(0, colonIndex) : children)
                    .filter(c => c.name !== 'COMMA');
                
                const conditionText = conditionNodes.map(reconstructText).join(', ');
                const actionNode = children.find(c => c.name === 'statement' || c.name === 'statement_or_null');

                let line = `${getIndent()}${conditionText}`;
                line = line.padEnd(formatterConfig.case_colon_align);
                line += ':';
                output += line;

                if (actionNode) {
                    if (actionNode.name === 'statement_or_null' && actionNode.children?.[0]?.name === 'SEMI') {
                        const padding = ' '.repeat(Math.max(1, formatterConfig.case_stmt_align - line.length));
                        output += padding + ';';
                        if (!skipComments) {
                            processTrailingComment(actionNode, formatterConfig.always_comment_align);
                        }
                        output += '\n';
                    } else if (actionNode.children?.[0]?.name === 'BEGIN') {
                        output += ' ';
                        processNode(actionNode, true); 
                    } else {
                        const padding = ' '.repeat(Math.max(1, formatterConfig.case_stmt_align - line.length));
                        processNode(actionNode, false, true, padding);
                    }
                }
                break;
            }
            
            case 'system_call':
            case 'task_enable_statement':
            case 'force_statement':
            case 'release_statement':
            case 'function_call':
            case 'delay_control':
            case 'event_control': {
                output += `${prefix}${indent}${reconstructText(node)};`;
                processTrailingComment(node, formatterConfig.always_comment_align);
                output += '\n';
                break;
            }
            case 'generate_block': {
                output += `\n${indent}generate\n`;
                indentLevel++;
                node.children?.forEach(child => {
                    if (child.name !== 'GENERATE' && child.name !== 'ENDGENERATE') {
                        processNode(child);
                    }
                });
                indentLevel--;
                output += `${indent}endgenerate\n`;
                break;
            }
            case 'generate_conditional': {
                const children = node.children || [];
                const conditionNode = children.find(c => c.name.endsWith('_expression'));
                output += `${indent}if (${reconstructText(conditionNode)})`;

                const thenNode = children.find(c => c.name === 'generate_statement_or_block');
                if (thenNode) {
                    if (thenNode.children?.[0]?.name === 'BEGIN') {
                        output += ' ';
                    }
                    processNode(thenNode, true);
                }

                const elseIndex = children.findIndex(c => c.name === 'ELSE');
                if (elseIndex > -1) {
                    output = output.trimEnd();
                    output += `\n${indent}else`;
                    const elseNode = children.find((c, i) => i > elseIndex && c.name === 'generate_statement_or_block');
                    if (elseNode) {
                        if (elseNode.children?.[0]?.name === 'BEGIN') {
                            output += ' ';
                        }
                        processNode(elseNode, true);
                    }
                }
                break;
            }
            case 'generate_case_construct': {
                const children = node.children || [];
                const conditionNode = children.find(c => c.name === 'hierarchical_identifier');
                output += `${indent}case (${reconstructText(conditionNode)})\n`;
                indentLevel++;
                children.filter(c => c.name === 'generate_case_item').forEach(item => processNode(item));
                indentLevel--;
                output += `${indent}endcase\n`;
                break;
            }
            case 'generate_case_item': {
                const children = node.children || [];
                const conditionNodes = children.filter(c => c.name === 'hierarchical_identifier' || c.name === 'DEFAULT');
                const conditionText = conditionNodes.map(reconstructText).join(', ');
                output += `${getIndent()}${conditionText}:`;

                const actionNode = children.find(c => c.name === 'generate_statement_or_block');
                if (actionNode) {
                    if (actionNode.children?.[0]?.name === 'BEGIN') {
                        output += ' ';
                    }
                    processNode(actionNode, true);
                }
                break;
            }
            case 'generate_loop': {
                const children = node.children || [];
                const initializationNode = children[2];
                const conditionNode = children[4];
                const stepNode = children[6];
                const bodyNode = children.find(c => c.name === 'generate_statement_or_block');

                const init = reconstructText(initializationNode).replace(/\s+/g, ' ');
                const cond = reconstructText(conditionNode).replace(/\s+/g, ' ');
                const step = reconstructText(stepNode).replace(/\s+/g, ' ');

                output += `${indent}for(${init}; ${cond}; ${step})`;
                if (bodyNode) {
                    if (bodyNode.children?.[0]?.name === 'BEGIN') {
                        output += ' ';
                    }
                    processNode(bodyNode, true);
                }
                break;
            }
            case 'generate_statement_or_block': {
                const children = node.children || [];
                const firstChild = children[0];

                if (firstChild && firstChild.name === 'BEGIN') {
                    const blockNameNode = children.find(c => c.name === 'IDENTIFIER');
                    output += `begin`;
                    if (blockNameNode) {
                        output += ` : ${blockNameNode.value}`;
                    }
                    output += `\n`;

                    indentLevel++;
                    const innerItems = children.filter(c => c.name !== 'BEGIN' && c.name !== 'END' && c.name !== 'COLON' && c.name !== 'IDENTIFIER');
                    innerItems.forEach(child => processNode(child));
                    indentLevel--;

                    output += `${getIndent()}end\n`;
                } else {
                    children.forEach(child => processNode(child));
                }
                break;
            }
            default:            
            break;
        }
    }

    processNode(ast);
    return output.trim() + '\n';
}