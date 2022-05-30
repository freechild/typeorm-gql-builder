/* tslint:disable */
/* eslint-disable */

import {
    GraphQLObjectType,
    GraphQLResolveInfo,
    FieldNode,
    GraphQLOutputType,
    GraphQLFieldMap,
} from 'graphql';

export class CustomGraphQLObjectType extends GraphQLObjectType {
    table: string;
    alias?: string;
    pk: string;
    fk: string;
    schema: string;
    relations?: {
        name: string;
        table: string;
        parentKey: string;
        childKey: string;
    }[];
    childNode: CustomGraphQLObjectType[];
    // _fields?: any;
}

export interface CustomGraphQLFieldNode extends FieldNode {
    name: any;
}

export declare type CustomGraphQLFieldObjectType<T, K> = {
    first?: number;
    last?: number;
    orderBy?: T[] | T;
    where: K | {};
    page?: number;
    after?: number;
    before?: number;
    skip?: number;
    group?: boolean;
};

export interface CustomResolveInfo extends GraphQLResolveInfo {
    parentType: CustomGraphQLObjectType;
    schemaType: string;
}

export interface CustomResolveInfo extends GraphQLResolveInfo {
    parentType: CustomGraphQLObjectType;
    fieldNodes: FieldNode[];
    returnType: GraphQLOutputType;
    schemaType: string;
}

export interface TableInfo extends CustomGraphQLObjectType {
    fields?: GraphQLFieldMap<any, any>;
    data?: Record<string, any>;
    relations?: any;
    repo?: string;
}
