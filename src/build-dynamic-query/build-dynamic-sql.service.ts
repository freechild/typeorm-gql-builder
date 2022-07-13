import {
    EntityManager,
    QueryBuilder,
    Repository,
    SelectQueryBuilder,
} from 'typeorm';

import {
    FieldNode,
    FragmentDefinitionNode,
    ArgumentNode,
    FragmentSpreadNode,
    GraphQLSchema,
    OperationDefinitionNode,
    print,
    GraphQLOutputType,
    GraphQLObjectType,
    GraphQLList,
    OperationTypeNode,
} from 'graphql';
import * as R from 'ramda';
import { getDirective } from '@graphql-tools/utils';
import { ObjMap } from 'graphql/jsutils/ObjMap';

import { CreateDynamicSqlDto, Operation, SqlQuery } from './dto/sql.dto';
import { getFieldQuery } from './sql/typeorm';
import { BaseSqlService } from './base.service';
import {
    getReturnModelInfo,
    getReturnType,
    getTableInfo,
    makeQuery,
} from './lib/common';
import {
    CustomGraphQLObjectType,
    CustomResolveInfo,
    TableInfo,
} from './dto/customGraphQLObjectType.dto';
import { GraphQLResolveInfo } from 'graphql/type';

export class BuildDynamicSqlService<Model> {
    private sql: BaseSqlService<Model>;
    constructor() {}

    setSql(target: BaseSqlService<Model>) {
        this.sql = target;
    }

    get getSql() {
        if (!this.sql) throw 'error';
        return this.sql;
    }

    get getDbType() {
        return this.sql.db.options.type;
    }

    private getRelationInfo(
        childRelations: any,
        parent: string,
        child: string,
        parentRelations?: any,
    ) {
        let relations = childRelations;
        const relationHash: any = R.filter(R.propEq('table', parent))(
            relations,
        );
        const relation =
            relationHash.length > 1
                ? R.find(R.propEq('alias', child))(relationHash)
                : relationHash[0];

        const childKey = relation?.childKey
            ? relation?.childKey
            : relation?.parentKey;
        if (!childKey && parentRelations) {
            const relationHash: any = R.filter(R.propEq('table', child))(
                parentRelations,
            );
            return relationHash.length > 1
                ? R.find(R.propEq('alias', child))(parentRelations)
                : parentRelations[0];
        }
        return relation;
    }

    private graphqlParser(
        {
            fieldNodes,
            fragments,
            schema,
            operation,
            returnType,
            variableValues,
        }: {
            fieldNodes?: FieldNode[];
            fragments?: ObjMap<FragmentDefinitionNode>;
            schema: GraphQLSchema;
            operation: OperationDefinitionNode;
            returnType: GraphQLOutputType;
            variableValues: GraphQLResolveInfo['variableValues'];
        },
        tableInfo?: TableInfo,
        parentInfo?: any,
        fields?: any,
        exception?: any,
        PassPrefixCode?: any,
        operationType?: OperationTypeNode,
    ) {
        const prefixCode = PassPrefixCode ? PassPrefixCode : 64;

        let bin = fieldNodes.map((node: FieldNode): CreateDynamicSqlDto => {
            let cacheKeyValue: any | null;
            let cacheKey = tableInfo.pk;
            let parentPrimaryKey: string;
            const gqlNode = makeQuery({
                operation,
                fieldNodes,
                fragments,
                fields: variableValues,
                returnType: getReturnType(returnType),
                fieldsNode: tableInfo.fields,
                schema,
                operationType,
            });
            const alias = node.alias
                ? node.alias.value
                : tableInfo.table
                ? tableInfo.table
                : tableInfo.name;
            const table: string = tableInfo.table ?? tableInfo.name;
            if (!fields?.where) {
                fields.where = {};
            }
            if (parentInfo?.data) {
                if (
                    !tableInfo?.relations ||
                    tableInfo?.relations?.length === 0
                ) {
                    const relations = {
                        table: parentInfo.name,
                        childKey: tableInfo.pk,
                        parentKey: tableInfo.pk,
                    };
                    tableInfo.relations = [relations];
                }
                const relation = this.getRelationInfo(
                    tableInfo.relations,
                    parentInfo.name,
                    node.name.value,
                    parentInfo.relations,
                );

                const childKey = relation.childKey
                    ? relation.childKey
                    : relation.parentKey;
                tableInfo['fk'] = childKey;
                cacheKeyValue = parentInfo?.data?.[relation.parentKey]
                    ? parentInfo.data[relation.parentKey]
                    : '';
                const parentKey = relation.parentKey;
                cacheKey = childKey;
                parentPrimaryKey = parentInfo.pk;
                if (!parentInfo.data[parentKey])
                    throw new Error(`parent keys not found @(fk:${parentKey})`);
                fields.where[`${childKey}__parent`] =
                    parentInfo.data[parentKey];
                // fields.where[`${childKey}__in`] = '##PARENT##';
            }

            const currentNode = parentInfo.fields[node.name.value];
            if (!R.isNil(exception)) {
                if (!R.includes(tableInfo.name, exception)) return;
            }
            const argumentHash = (() => {
                let isJoin = {};
                let selfSchema: any;
                let model = {};
                node.arguments.map((argument: ArgumentNode) => {
                    if (argument.name.value === 'where') {
                        const whereNode: any = R.find(
                            R.propEq('name', argument.name.value),
                        )(currentNode.args);

                        selfSchema = getReturnModelInfo(
                            whereNode.type,
                        ).getFields();
                        const temp = this.whereParser(
                            fields.where,
                            { name: alias, info: tableInfo },
                            null,
                            prefixCode,
                            schema,
                        );
                        isJoin = temp.isJoin;
                        fields[argument.name.value] = temp.where;
                        temp.info.alias = alias;
                        model = temp.info;
                    } else if (argument.name.value === 'data') {
                        fields[argument.name.value] = fields.data;
                    }
                });
                return {
                    fields,
                    isJoin,
                    schema: selfSchema,
                };
            })();

            let selectSet: string[] = [];
            let tempArr = [];

            if (!R.isNil(node.selectionSet)) {
                node.selectionSet?.selections.map(
                    (w: FieldNode | FragmentSpreadNode) => {
                        if (w.kind === 'FragmentSpread') {
                            const filter = (n: any) => {
                                if (
                                    !n.selectionSet &&
                                    n.name.value !== '__typename'
                                ) {
                                    selectSet.push(`${alias}.${n.name.value}`);
                                }
                                return n.selectionSet !== undefined;
                            };
                            tempArr = tempArr.concat(
                                R.filter(
                                    filter,
                                    fragments[w.name.value].selectionSet
                                        .selections,
                                ),
                            );
                        } else {
                            if (
                                !w.selectionSet &&
                                w.name.value !== '__typename'
                            ) {
                                selectSet.push(`${alias}.${w.name.value}`);
                            }
                        }
                    },
                );
            }

            return {
                alias,
                table,
                repo: tableInfo.repo,
                name: node.name.value,
                selectSet,
                pk: tableInfo.pk,
                ...argumentHash,
                info: tableInfo,
                cacheKeyValue,
                cacheKey,
                parentPrimaryKey,
                gqlNode,
            };
        });
        bin = R.without([undefined], bin);
        return bin;
    }

    private getParserModel<T>(
        {
            operation,
            fieldNodes,
            fragments,
            returnType,
            parentType,
            schema,
            schemaType,
            fieldName,
            variableValues,
        }: CustomResolveInfo,
        fields: T,
        operationType?: OperationTypeNode,
        parent?: any,
    ) {
        const parentFields = parentType.getFields();
        const focusType = getDirective(
            schema,
            parentFields[fieldName],
            'schema',
        )?.[0] as CustomGraphQLObjectType;

        const modelInfo = getTableInfo(
            focusType ? focusType.name : schemaType ? schemaType : returnType,
            schema,
        );

        return this.graphqlParser(
            {
                operation,
                fieldNodes,
                fragments,
                schema,
                returnType,
                variableValues,
            },
            modelInfo,
            getTableInfo(parentType.name, schema, parent),
            fields,
            null,
            0,
            operationType,
        );
    }

    private whereParser(
        obj: Object,
        model: Record<string, any>,
        parent: Object,
        prefixCode: number,
        schema: GraphQLSchema,
    ) {
        let isJoin = {};
        let where = {};
        const info = model.info;
        info.childNode = [];
        const currentprefixName = String.fromCharCode(prefixCode);
        const alias = currentprefixName;
        if (!obj) {
            return;
        }
        Object.keys(obj).forEach((key) => {
            let tempJoin = {};
            let tempWhere = {};
            let prefixName = String.fromCharCode(prefixCode);
            if (prefixCode > 91)
                prefixName = String.fromCharCode(90) + (prefixCode - 90);
            if (key.includes('__lateral') === true) {
                prefixCode += 1;
                prefixName = String.fromCharCode(prefixCode);
                const target = tempJoin;
                const targetName = key.includes('.') ? key.split('.')[1] : key;
                target[`${targetName}*AS*${prefixName}`] = {};
            } else if (key.includes('__some') === true || parent) {
                if (R.type(obj[key]) === 'Object') {
                    prefixCode += 1;
                    prefixName = String.fromCharCode(prefixCode);
                    if (prefixCode > 91)
                        prefixName =
                            String.fromCharCode(90) + (prefixCode - 90);
                    const childModel =
                        model.info.fields[key.split('__some')[0]];

                    const modelInfo = getTableInfo(childModel.type, schema);
                    const tempReuslt = this.whereParser(
                        obj[key],
                        { name: prefixName, info: modelInfo },
                        key,
                        prefixCode,
                        schema,
                    );
                    tempJoin[`${key}*AS*${prefixName}`] = {};
                    tempJoin[`${key}*AS*${prefixName}`] = tempReuslt.isJoin;
                    tempWhere = tempReuslt.where;
                    prefixCode = tempReuslt.prefixCode;
                    tempReuslt.info.alias = tempReuslt.alias;
                    tempReuslt.info.name = childModel.name;
                    info.childNode.push(tempReuslt.info);
                } else {
                    if (key === 'OR' || key === 'AND') {
                        tempWhere[key] = [];
                        const filter = (x) => {
                            const temp = this.whereParser(
                                x,
                                model,
                                null,
                                prefixCode,
                                schema,
                            );
                            tempWhere[key].push(temp.where);
                            tempJoin = R.merge(tempJoin, temp.isJoin);
                            prefixCode = temp.prefixCode;
                        };
                        R.map(filter, obj[key]);
                    } else if (!parent)
                        tempWhere[`${model.name}.${key}`] = obj[key];
                    else {
                        tempWhere[`${currentprefixName}.${key}`] = obj[key];
                    }
                }
            } else if (key === 'OR' || key === 'AND') {
                tempWhere[key] = [];
                const filter = (x) => {
                    const temp = this.whereParser(
                        x,
                        model,
                        null,
                        prefixCode,
                        schema,
                    );
                    tempWhere[key].push(temp.where);
                    tempJoin = R.mergeRight(tempJoin, temp.isJoin);
                    prefixCode = temp.prefixCode;
                };
                R.map(filter, obj[key]);
            } else {
                if (key.includes('.')) {
                    tempWhere[`${key}`] = obj[key];
                } else {
                    tempWhere[`${model.name}.${key}`] = obj[key];
                }
            }

            where = R.mergeWith(R.concat, where, tempWhere);
            isJoin = R.mergeWith(R.concat, isJoin, tempJoin);
        });
        return { where, isJoin, prefixCode, info, alias };
    }

    normalFindAllWithOutExecute<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        sql: BaseSqlService<Model> | Repository<Model> | EntityManager = this
            .sql,
        parent?: Parent,
    ) {
        const bin = this.getParserModel(
            customResolveInfo,
            fields,
            OperationTypeNode.QUERY,
            parent,
        );
        const result = this.makeSelectQuery(bin, 0, sql, this.getDbType);
        return result;
    }

    insertWithOutExecute<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        sql: BaseSqlService<Model> | Repository<Model> | EntityManager = this
            .sql,
        parent?: Parent,
    ) {
        const bin = this.getParserModel(
            customResolveInfo,
            fields,
            OperationTypeNode.MUTATION,
            parent,
        );
        const result = this.makeInsertQuery(
            bin,
            0,
            customResolveInfo.schema,
            sql,
            this.getDbType,
        );
        return result;
    }

    updateWithOutExecute<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        sql: BaseSqlService<Model> | Repository<Model> | EntityManager = this
            .sql,
        parent?: Parent,
    ) {
        const bin = this.getParserModel(
            customResolveInfo,
            fields,
            OperationTypeNode.MUTATION,
            parent,
        );
        const result = this.makeUpdateQuery(
            bin,
            0,
            customResolveInfo.schema,
            sql,
            this.getDbType,
        );
        return result;
    }

    deleteWithOutExecute<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        sql: BaseSqlService<Model> | Repository<Model> | EntityManager = this
            .sql,
        parent?: Parent,
    ) {
        const bin = this.getParserModel(
            customResolveInfo,
            fields,
            OperationTypeNode.MUTATION,
            parent,
        );
        const result = this.makeDeleteQuery(bin, 0, sql, this.getDbType);

        return result;
    }

    private getQueryBuilder<Model>(
        table?: string,
        alias?: string,
        sql?: BaseSqlService<Model> | Repository<Model> | EntityManager,
    ) {
        let runner: SelectQueryBuilder<Model>;
        if (sql instanceof BaseSqlService && sql.target === '') {
            runner = sql.repository.createQueryBuilder(alias);
        } else if (sql instanceof EntityManager) {
            runner = sql.createQueryBuilder(table, alias);
        } else {
            runner = sql.createQueryBuilder(alias);
        }

        return runner;
    }

    makeSelectQuery<Model>(
        bin: CreateDynamicSqlDto[],
        index: number = 0,
        sql?: BaseSqlService<Model> | Repository<Model> | EntityManager,
        type?: string,
    ): SqlQuery[] {
        const results = bin.map((model: CreateDynamicSqlDto) => {
            const operation = Operation.Select;
            const alias =
                model.alias !== '' && model.alias ? model.alias : model.name;
            const name = model.name;
            model.table = model.table ?? model.name;

            const runner = this.getQueryBuilder<Model>(model.table, alias, sql);
            const result = getFieldQuery(
                model,
                operation,
                index,
                runner,
                null,
                type,
            );
            const [query, params] = result.expressionMap.mainAlias
                ? result.getQueryAndParameters()
                : ['', []];

            return {
                name,
                alias,
                operation,
                parentKeyName: model.parentPrimaryKey,
                cacheKey: model.cacheKeyValue,
                cacheKeyName: model.cacheKey,
                query,
                params,
                typeorm: result as QueryBuilder<Model>,
                gqlNode: model.gqlNode,
            };
        });
        return results;
    }

    makeInsertQuery<Model>(
        bin: CreateDynamicSqlDto[],
        index: number = 1,
        schema: GraphQLSchema,
        sql?: BaseSqlService<Model> | Repository<Model> | EntityManager,
        type?: string,
    ) {
        const result = bin.map((model: CreateDynamicSqlDto) => {
            const operation = Operation.Insert;
            const alias =
                model.alias !== '' && model.alias ? model.alias : model.name;
            const name = model.name;
            model.table = model.table ?? model.name;
            const runner = this.getQueryBuilder<Model>(
                model.table,
                alias,
                sql,
            ).insert();
            const [data, children] = this.dataParser<Model>(
                model,
                schema,
                operation,
            );
            runner.values(data);
            const [query, params] = runner.expressionMap.mainAlias
                ? runner.getQueryAndParameters()
                : ['', []];
            return {
                name,
                query,
                data,
                params,
                alias,
                children,
                operation,
                repo: model.repo,
                parentKeyName: model.parentPrimaryKey,
                cacheKey: model.cacheKeyValue,
                cacheKeyName: model.info.fk,
                typeorm: runner as QueryBuilder<Model>,
                gqlNode: model.gqlNode,
            };
        });
        return result;
    }

    makeUpdateQuery<Model>(
        bin: CreateDynamicSqlDto[],
        index = 0,
        schema: GraphQLSchema,
        sql?: BaseSqlService<Model> | Repository<Model> | EntityManager,
        type?: string,
    ): SqlQuery[] {
        const result = bin.map((model: CreateDynamicSqlDto) => {
            let operation: Operation = Operation.Update;
            const alias =
                model.alias !== '' && model.alias ? model.alias : model.name;
            const name = model.name;
            model.table = model.table ?? model.name;
            const where = model.fields.where;
            let query: string;
            let params: string[] = [];
            let result: QueryBuilder<Model>;

            const updateRunner = this.getQueryBuilder<Model>(
                model.table,
                alias,
                sql,
            ).update();
            const selectRunner = this.getQueryBuilder<Model>(
                model.table,
                alias,
                sql,
            );

            const [data, children, curOperation] = this.dataParser<Model>(
                model,
                schema,
                operation,
            );
            operation = curOperation;
            if (operation === Operation.Update) {
                result = getFieldQuery(
                    model,
                    operation,
                    index,
                    updateRunner,
                    null,
                    type,
                );
                updateRunner.set(data);
            } else {
                result = getFieldQuery(
                    model,
                    operation,
                    index,
                    selectRunner,
                    null,
                    type,
                );
            }

            [query, params] = result.expressionMap.mainAlias
                ? result.getQueryAndParameters()
                : ['', []];

            return {
                name,
                query,
                data,
                where,
                params,
                alias,
                children,
                operation,
                repo: model.repo,
                parentKeyName: model.parentPrimaryKey,
                cacheKey: model.cacheKeyValue,
                cacheKeyName: model.info.fk,
                typeorm: result as QueryBuilder<Model>,
                typeormForGetter: getFieldQuery(
                    model,
                    operation,
                    index,
                    selectRunner,
                    null,
                    type,
                ),
                gqlNode: model.gqlNode,
            };
        });
        return result;
    }

    makeDeleteQuery<Model>(
        bin: CreateDynamicSqlDto[],
        index: number = 0,
        sql?: BaseSqlService<Model> | Repository<Model> | EntityManager,
        type?: string,
    ) {
        const results = bin.map((model: CreateDynamicSqlDto) => {
            const operation = Operation.Delete;

            const alias =
                model.alias !== '' && model.alias ? model.alias : model.name;
            const name = model.name;
            model.table = model.table ?? model.name;
            const runner = this.getQueryBuilder<Model>(
                model.table,
                alias,
                sql,
            ).delete();
            const result = getFieldQuery(
                { ...model, alias: model.table },
                operation,
                index,
                runner,
                null,
                type,
            );
            const [query, params] = result.expressionMap.mainAlias
                ? result.getQueryAndParameters()
                : ['', []];

            return {
                name,
                alias,
                operation,
                parentKeyName: model.parentPrimaryKey,
                cacheKey: model.cacheKeyValue,
                cacheKeyName: model.cacheKey,
                query,
                params,
                typeorm: result,
                typeormForGetter: getFieldQuery(
                    model,
                    operation,
                    index,
                    this.getQueryBuilder<Model>(model.table, alias, sql),
                    null,
                    type,
                ),
                gqlNode: model.gqlNode,
            };
        });
        return results;
    }

    dataParser<Model>(
        model: CreateDynamicSqlDto,
        schema: GraphQLSchema,
        operation: Operation,
    ): [Model, SqlQuery[], Operation] {
        const data: any = {};
        const children: SqlQuery[] = [];
        for (const [key, value] of Object.entries(model.fields.data)) {
            if (typeof value === 'object') {
                for (const [subKey, subValue] of Object.entries(value)) {
                    const child = subValue;
                    if (subKey === QueryDataActionKey.create) {
                        const childType = getTableInfo(
                            key.capitalize(),
                            schema,
                        );
                        const childRepo = this.sql.db.getRepository(
                            childType.name,
                        );

                        const childInfo = model.info.relations.find(
                            (i) => i.table === key,
                        );
                        if (childInfo) {
                            const childNode = this.makeInsertQuery(
                                child.map((v: IRelationModel) => {
                                    return {
                                        selectSet: [],
                                        alias: childType
                                            ? childType.name
                                            : childInfo.table,
                                        table: childType
                                            ? childType.table
                                            : childInfo.table,
                                        name: childType
                                            ? childType.name
                                            : childInfo.table,
                                        pk: childType.pk,
                                        cacheKeyName: childInfo.childKey,
                                        parentPrimaryKey: childInfo.childKey,
                                        info: childType
                                            ? {
                                                  ...childType,
                                                  fk: childInfo.parentKey,
                                              }
                                            : ({
                                                  table: childInfo.table,
                                                  pk: childInfo.childKey,
                                                  fk: childInfo.parentKey,
                                              } as CustomGraphQLObjectType),
                                        fields: {
                                            data: {
                                                ...v,
                                                [childInfo.parentKey]:
                                                    '$parent$',
                                            },
                                        },
                                    } as CreateDynamicSqlDto;
                                }) as CreateDynamicSqlDto[],
                                0,
                                schema,
                                childRepo,
                            );
                            childNode.map((v) => children.push(v));
                        }
                    } else if (subKey === QueryDataActionKey.update) {
                        const childType = getTableInfo(
                            key.capitalize(),
                            schema,
                        );
                        const childRepo = this.sql.db.getRepository(
                            childType.name,
                        );

                        const childInfo = model.info.relations.find(
                            (i) => i.table === key,
                        );
                        if (childInfo) {
                            const childNode = this.makeUpdateQuery(
                                child.map((v: IUpdate) => {
                                    return {
                                        selectSet: [],
                                        alias: childType
                                            ? childType.name
                                            : childInfo.table,
                                        table: childType
                                            ? childType.table
                                            : childInfo.table,
                                        name: childType
                                            ? childType.name
                                            : childInfo.table,
                                        cacheKeyName: childInfo.childKey,
                                        parentPrimaryKey: childInfo.childKey,
                                        pk: childType.pk,
                                        info: childType
                                            ? {
                                                  ...childType,
                                                  fk: childInfo.parentKey,
                                              }
                                            : ({
                                                  table: childInfo.table,
                                                  pk: childInfo.childKey,
                                                  fk: childInfo.parentKey,
                                              } as CustomGraphQLObjectType),
                                        fields: {
                                            data: v.data,
                                            where: {
                                                ...v.where,
                                                [childInfo.parentKey]:
                                                    '$parent$',
                                            },
                                        },
                                    } as CreateDynamicSqlDto;
                                }) as CreateDynamicSqlDto[],
                                0,
                                schema,
                                childRepo,
                            );
                            childNode.map((v) => children.push(v));
                        }
                    } else if (subKey === QueryDataActionKey.connect) {
                        const childInfo = model.info.relations.find(
                            (i) => i.table === key,
                        );
                        if (child) {
                            Object.keys(child).forEach((rootKey) => {
                                if (R.isNil(childInfo)) {
                                    data[rootKey] = child[rootKey];
                                } else {
                                    data[childInfo.childKey] = child[rootKey];
                                }
                            });
                        }
                    }
                }
            } else {
                if (key === '_onlySearch') {
                    operation = Operation.Select;
                } else {
                    data[key] = value;
                }
            }
        }
        if (operation === Operation.Update && R.isEmpty(data)) {
            operation = Operation.Select;
        }
        return [data, children, operation];
    }
}

interface JoinInfo {
    query?: string;
    table?: string;
    alias?: string;
}
enum QueryDataActionKey {
    create = 'create',
    connect = 'connect',
    update = 'update',
}

interface IRelationModel {
    table: string;
    parentKey: string;
    childKey: string;
}

interface IUpdate {
    data: string[];
    where: string[];
}
