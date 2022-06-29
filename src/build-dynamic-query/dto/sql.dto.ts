import {
    FragmentDefinitionNode,
    GraphQLFieldMap,
    GraphQLSchema,
    OperationDefinitionNode,
} from 'graphql';
import { QueryBuilder } from 'typeorm';
import { CustomGraphQLObjectType } from './customGraphQLObjectType.dto';

type XPromise<T> = Promise<T>;

export interface OperationNode {
    nodeName: string;
    query: OperationDefinitionNode;
    fragments: {
        [key: string]: FragmentDefinitionNode;
    };
    fragmentsQuery: string[];
    fields: {
        [key: string]: any;
    };
    returnType: 'Array' | 'Object' | 'Boolean';
    fieldsNode?: GraphQLFieldMap<any, any>;
    schema: GraphQLSchema;
}

export class CreateDynamicSqlDto {
    index?: number;
    table?: string;
    alias?: string;
    name!: string;
    pk?: string;
    fk?: string;
    selectSet?: string[] | string = [];
    isJoin?: any;
    // where?:LogInWhereInput;
    fields?: Fields;
    parentPrimaryKey?: string;
    cacheKey?: string;
    cacheKeyValue?: string;
    info?: CustomGraphQLObjectType;
    repo?: string;
    schema?: any;
    gqlNode?: OperationNode;
}

export class Fields<T = any> {
    first?: number;
    last?: number;
    orderBy?: string[] | string;
    where?: T | any;
    page?: number;
    after?: number;
    before?: number;
    skip?: number;
    group?: boolean;
    data: any;
}

export interface BatchResultForm {
    cacheKey: any;
    table: string;
    alias: string;
    data: XPromise<any>;
}

export enum Operation {
    Select = 'Select',
    Insert = 'Insert',
    Update = 'Update',
    Delete = 'Delete',
    Count = 'Count',
}

export class SqlRunner implements SqlQuery {
    readonly name: string;
    readonly alias: string;
    query?: string = '';
    params?: string[] = [];
    where?: any;
    data?: any;
    index?: number;
    operation: Operation;
    children?: SqlQuery[];
    cacheKey?: any;
    cacheKeyName?: string;
    repo?: string;
    parentKeyName?: string;
    typeorm: QueryBuilder<any>;
    typeormForGetter?: QueryBuilder<any>;
    gqlNode?: OperationNode;

    constructor(node: SqlQueryWithOutRunner) {
        this.query = node.query;
        this.params = node.params;
        this.where = node.where;
        this.data = node.data;
        this.name = node.name;
        this.index = node.index;
        this.alias = node.alias;
        this.operation = node.operation;
        this.children = node.children;
        this.cacheKey = node.cacheKey;
        this.cacheKeyName = node.cacheKeyName;
        this.repo = node.repo;
        this.parentKeyName = node.parentKeyName;
        this.typeormForGetter = node.typeormForGetter;
        this.gqlNode = node.gqlNode;
    }

    add: () => {};
}

export interface SqlQuery {
    query?: string;
    params?: string[];
    where?: any;
    data?: any;
    name: string;
    index?: number;
    alias: string;
    operation: Operation;
    children?: SqlQuery[];
    cacheKey?: any;
    cacheKeyName?: string;
    repo?: string;
    parentKeyName?: string;
    typeorm: QueryBuilder<any>;
    typeormForGetter?: QueryBuilder<any>;
    gqlNode?: OperationNode;
}

type SqlQueryWithOutRunner = Omit<SqlQuery, 'typeorm'>;
