// src/ast-types.ts

// 定义位置信息结构
export interface AstPosition {
    line: number;
    column: number;
}

export interface CommentNode {
    text: string;
    type: 'comment';
    tokenIndex: number;
}

export interface AstNode {
    name: string;
    value?: string;
    children?: AstNode[];
    attributes?: { [key: string]: any };
    leadingComments?: CommentNode[];
    trailingComments?: CommentNode[];
    start?: AstPosition;
    end?: AstPosition;
}
