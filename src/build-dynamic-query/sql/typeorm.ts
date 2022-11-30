import { getDirective } from '@graphql-tools/utils';
import { FieldNode, Kind, SelectionNode } from 'graphql';
import * as R from 'ramda';
import {
    QueryBuilder,
    SelectQueryBuilder,
    UpdateQueryBuilder,
    DeleteQueryBuilder,
    OrderByCondition,
} from 'typeorm';
import { getTableInfo } from '../lib/common';
import {
    CreateDynamicSqlDto,
    Fields,
    Operation,
    OperationNode,
} from '../dto/sql.dto';

import { ObjectLiteral } from '../dto/ObjectLiteral';

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

export function getFieldQuery(
    model: CreateDynamicSqlDto,
    operation: Operation = Operation.Select,
    index: number,
    sql:
        | SelectQueryBuilder<any>
        | UpdateQueryBuilder<any>
        | DeleteQueryBuilder<any>,
    size?: number | undefined,
    type?: string,
) {
    const runner = sql as SelectQueryBuilder<any>;
    if (size && model.fields) model.fields.first = 1;
    const result = fieldParser(model, operation, index, runner, type);
    return result as QueryBuilder<any>;
}

export function fieldParser(
    model: CreateDynamicSqlDto,
    operation: Operation = Operation.Select,
    index: number,
    sql:
        | SelectQueryBuilder<any>
        | UpdateQueryBuilder<any>
        | DeleteQueryBuilder<any>,
    type: string = sql.connection?.options?.type,
) {
    const field: CreateDynamicSqlDto['fields'] = model.fields ?? new Fields();
    let orderValue: string[] = [];
    let limit: number = 10;
    if (!R.isNil(model.selectSet) && !Array.isArray(model.selectSet))
        model.selectSet = [model.selectSet];

    if (!R.isNil(field.first) || !R.isNil(field.last)) {
        limit = field.first ?? field.last ?? 10;
    }
    if (field.after || field.before) {
        if (field.after) {
            field.where[`${model.alias}.${model.pk}__gte`] = field.after;
        } else if (field.before) {
            field.where[`${model.alias}.${model.pk}__lte`] = field.before;
        }
    }

    if (!R.isEmpty(field.where) || !R.isEmpty(model.isJoin)) {
        if (
            !R.isEmpty(model.isJoin) &&
            !R.isNil(model.isJoin) &&
            sql instanceof SelectQueryBuilder
        ) {
            const result = join(model, index, field, sql, operation);
            orderValue = orderValue.concat(result.orderValue);
            if (sql.expressionMap.mainAlias) {
                field.group = true;
            }
        } else {
            const result = where(field.where, index, field, operation);
            sql.where(result.query, result.params);
            orderValue = orderValue.concat(result.orderValue);
        }
    }

    if (sql instanceof SelectQueryBuilder) {
        const orderKey = field.orderBy;
        if (orderKey) {
            sql.orderBy(order(model, orderKey, orderValue));
        }
        if (field.skip) {
            sql.offset(field.skip);
        }
        if (field.page) {
            // TODO:
            const page = (field.page - 1) * limit;
            sql.offset(page);
        }
        if (field.group) {
            group(model.selectSet, sql);
        } else {
            const alias = sql.expressionMap.mainAlias ? sql.alias : '';
            if (type === 'mysql') {
                sql.addSelect(`
                \`${alias}\`.*,
                \`${alias}\`.${model.pk} _id
                `);
            } else {
                sql.addSelect(`"${alias}".*,"${alias}".${model.pk} _id`);
            }
        }
        sql.limit(limit);
    }

    const selectionSet = (
        model.gqlNode?.query.selectionSet.selections[0] as FieldNode
    ).selectionSet;
    if (
        !sql.expressionMap.mainAlias &&
        selectionSet &&
        model.gqlNode
        // (model.gqlNode.query.selectionSet.selections[0] as FieldNode)
    ) {
        const selectionsNode = addSelectionSetNode(
            selectionSet.selections as FieldNode[],
            // (model.gqlNode.query.selectionSet.selections[0] as FieldNode)
            //     .selectionSet.selections as FieldNode[],
            model.gqlNode.schema,
            model.info,
            model.gqlNode.fragments,
            field.group,
        );

        selectionSet.selections = [...selectionsNode];
    }

    return sql;
}

function addSelectionSetNode(
    node: FieldNode[],
    schema: CreateDynamicSqlDto['schema'],
    info: CreateDynamicSqlDto['info'],
    fragments: OperationNode['fragments'],
    isGroup: Boolean = false,
) {
    let selectionsNode: FieldNode[] = [];
    const parserSelectionSetNode = (
        selectionsNode: any[],
        currentNode: FieldNode,
    ) => {
        const tempNode = { ...currentNode } as SelectionNode;
        if (tempNode.kind === 'FragmentSpread') {
            selectionsNode.push(tempNode);
            const fragmentNode = fragments![tempNode.name.value].selectionSet
                .selections as FieldNode[];
            fragmentNode.reduce(parserSelectionSetNode, selectionsNode);
        } else if (tempNode.kind === 'Field') {
            if (tempNode.selectionSet) {
                let selectionNode = tempNode.selectionSet
                    .selections as FieldNode[];

                const type = getTableInfo(
                    info!.fields[tempNode.name.value].type,
                    schema,
                );
                const groupBy = tempNode.arguments?.filter(
                    (i) => i.name.value === 'group',
                );
                const childNode = addSelectionSetNode(
                    selectionNode,
                    schema,
                    type,
                    fragments,
                    groupBy?.length ? true : false,
                );
                (tempNode.selectionSet.selections as any) = childNode;
                selectionsNode.push(tempNode);
            } else {
                if (info?.fields[currentNode.name.value]) {
                    const checkGroup = getDirective(
                        schema,
                        info.fields[currentNode.name.value],
                        'group',
                    );
                    if (checkGroup) isGroup = true;
                }
                selectionsNode.push(tempNode);
            }
        }
        return selectionsNode;
    };
    node.reduce(parserSelectionSetNode, selectionsNode);
    if (!isGroup && info?.pk && info.relations) {
        R.uniq([info.pk, ...info.relations.map((i) => i.childKey)]).map((i) => {
            const node: FieldNode = {
                kind: Kind.FIELD,
                arguments: [],
                name: {
                    kind: Kind.NAME,
                    value: i,
                },
            };
            if (!selectionsNode.find((j) => j.name.value === i)) {
                selectionsNode.push(node);
            }
            // if (!selectionsNode.find((j) => j.name.value === i)) {
            //     selectionsNode.push(node);
            // }
        });
    }
    return selectionsNode;
}

export function where(
    target: Object,
    index: number = 0,
    fields?: CreateDynamicSqlDto['fields'],
    operation: Operation = Operation.Select,
    joinInfoList?: JoinInfo[],
    operator: 'AND' | 'OR' = 'AND',
) {
    let linkWord: '' | 'AND' | 'OR' = '';
    let query = '';
    let params = {};
    let i: number = 0;
    let orderValue: string[] = [];
    for (const [key, value] of Object.entries(target)) {
        linkWord = i > 0 ? operator : '';
        if (key === 'AND' || key === 'OR') {
            linkWord = i > 0 ? operator : '';
            query += ` ${linkWord} (`;
            value.forEach((childValue: any, j: number) => {
                linkWord = j > 0 ? key : '';
                const result = where(
                    childValue,
                    index,
                    fields,
                    operation,
                    undefined,
                    key,
                );
                query += ` ${linkWord} ${result.query}`;
                params = R.mergeRight(params, result.params);
                index = result.index;
                orderValue = orderValue.concat(result.orderValue);
            });
            query += ')';
        } else {
            const ketSet: string[] = key.split('__');
            const result = makeWhereQuery(
                ketSet,
                value,
                index,
                fields,
                joinInfoList,
                operation,
            );
            if (result?.where) {
                query += ` ${linkWord} ${result.where}`;
                params = R.mergeRight(params, result.params);
                index = result.index;
                if (result.orderValue)
                    orderValue = orderValue.concat(result.orderValue);
            }
        }
        if (!R.isEmpty(query)) ++i;
    }

    return { query, index, params, orderValue };
}

function makeWhereQuery<model>(
    whereOption: string[],
    whereValue: any,
    index: number,
    fields: CreateDynamicSqlDto['fields'],
    joinInfoList?: JoinInfo[],
    operation: Operation = Operation.Select,
):
    | { where: string; params: Object; index: number; orderValue?: string[] }
    | undefined {
    if (R.isEmpty(whereValue)) {
        if (operation !== Operation.Select) throw `${whereOption} is empty`;

        return;
    }
    switch (whereOption[1]) {
        case 'not':
            index += 1;
            return {
                where: `${whereOption[0]} <> :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'in':
            index += 1;
            return {
                where: `${whereOption[0]} in (:...k${index})`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'not_in':
            index += 1;
            return {
                where: `${whereOption[0]} not in (:...k${index})`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'lt':
            index += 1;
            return {
                where: `${whereOption[0]} < :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'lte':
            index += 1;
            return {
                where: `${whereOption[0]} <= :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'gt':
            index += 1;
            return {
                where: `${whereOption[0]} > :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'gte':
            index += 1;
            return {
                where: `${whereOption[0]} >= :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'contains':
            index += 1;
            return {
                where: `${whereOption[0]} like :k${index}`,
                params: { [`k${index}`]: `%${whereValue.toLowerCase()}%` },
                index,
            };
        case 'not_contains':
            index += 1;
            return {
                where: `${whereOption[0]} not like :k${index}`,
                params: { [`k${index}`]: `%${whereValue.toLowerCase()}%` },
                index,
            };
        case 'starts_with':
            index += 1;
            return {
                where: `${whereOption[0]} like :k${index}`,
                params: { [`k${index}`]: `${whereValue.toLowerCase()}%` },
                index,
            };
        case 'not_starts_with':
            index += 1;
            return {
                where: `${whereOption[0]} not like :k${index}`,
                params: { [`k${index}`]: `${whereValue.toLowerCase()}%` },
                index,
            };
        case 'ends_with':
            index += 1;
            return {
                where: `${whereOption[0]} like :k${index}`,
                params: { [`k${index}`]: `%${whereValue.toLowerCase()}` },
                index,
            };
        case 'not_ends_with':
            index += 1;
            return {
                where: `${whereOption[0]} not like :k${index}`,
                params: { [`k${index}`]: `%${whereValue.toLowerCase()}` },
                index,
            };
        case 'json_contains':
            index += 1;
            return {
                where: `${whereOption[0]}::jsonb %> :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
        case 'json_filter':
        // params.push(whereValue.key);
        // params.push(whereValue.value);
        // query = `${whereOption[0]}::json ->> ${(index =
        //     index + 1)} = ${(index = index + 1)}`;
        // return {
        //     // where: `${whereOption[0]}::jsonb %> :k${index}`,
        //     where: `
        //         ${whereOption[0]}::json ->> ${(index =
        //         index + 1)} = ${(index = index + 1)}
        //     `,
        //     params: { [`k${index}`]: whereValue },
        //     index,
        // };
        case 'exist':
            if (typeof whereValue === 'boolean') {
                index += 1;
                return {
                    where: `${whereOption[0]} is ${
                        whereValue ? 'not' : ''
                    } null`,
                    params: [],
                    index,
                };
            }
            break;

        case 'between': {
            if (
                !whereValue ||
                !Array.isArray(whereValue) ||
                whereValue.length > 2
            ) {
                break;
            }
            let where = `${whereOption[0]} between`;
            const params = {};
            whereValue.map((value, i = 0) => {
                ++index;
                if (i > 0) {
                    where += ' AND ';
                }
                where += ` :k${index} `;
                params[`k${index}`] = value;
                ++i;
            });

            return {
                where,
                params,
                index,
            };
        }
        case 'search':
        case 'search_in': {
            const regStr = /[-']/gi;
            const tempStr = whereValue.replace(regStr, ' ');
            index += 1;
            fields!.group = true;
            return {
                where: `to_tsquery(f_unaccent(:k${index}) || ':*') @@  ${whereOption[0]} `,
                params: { [`k${index}`]: `'''${tempStr}'''` },
                index,
                orderValue: [
                    whereOption[0],
                    `to_tsquery(f_unaccent(:k${index}) || ':*')`,
                ],
            };
        }
        case 'not_include': {
            index += 1;
            const splitKey = whereOption[0].split('.');
            const alias = splitKey[0];
            const targetNode = joinInfoList?.find(
                (node) => node.alias === alias,
            );
            if (targetNode)
                return {
                    where: `NOT EXISTS (SELECT 1 FROM ${targetNode.table} WHERE ${targetNode.query} AND ${splitKey[1]} IN (:...k${index}))`,
                    params: { [`k${index}`]: whereValue },
                    index,
                };
            else return;
        }

        case 'parent': {
            index += 1;
            const key =
                typeof whereValue === 'string'
                    ? `parent_${whereValue.replace(/-/g, '_')}_${index}`
                    : `parent_${whereValue}_${index}`;
            return {
                where: `${whereOption[0]} = :${key}`,
                params: { [`${key}`]: whereValue },
                index,
            };
        }
        default:
            index += 1;
            return {
                where: `${whereOption[0]} = :k${index}`,
                params: { [`k${index}`]: whereValue },
                index,
            };
    }
}

function join<model extends ObjectLiteral>(
    model: CreateDynamicSqlDto,
    index: number,
    fields: CreateDynamicSqlDto['fields'],
    sql: SelectQueryBuilder<model>,
    operation: Operation = Operation.Select,
) {
    const isJoin = model.isJoin;
    const joinInfoList: JoinInfo[] = [];
    let orderValue: string[] = [];
    Object.keys(isJoin).forEach((key) => {
        let joinInfo: JoinInfo = {};
        const splitKey = key.split('__');
        const operation = splitKey[1].split('*AS*')[0];
        let ChildtableName = splitKey[0];
        const as = key.split('*AS*')[1];
        const relationModel = model.info?.relations?.find(
            (v: any) => v.table === ChildtableName,
        );
        let parentKey = model.info?.pk;
        let childKey = model.info?.pk;
        if (model.info?.relations && relationModel) {
            parentKey = relationModel.childKey;
            childKey = relationModel.parentKey ?? relationModel.childKey;
            ChildtableName = relationModel.table ?? ChildtableName;
        } else {
        }

        if (operation === 'lateral') {
        } else {
            if (sql.expressionMap.mainAlias) {
                sql.addSelect(`${model.info?.alias}.${parentKey}`).leftJoin(
                    `${ChildtableName}`,
                    as,
                    `${model.info?.alias}.${parentKey} = ${as}.${childKey} `,
                );
            }
        }
        joinInfo.query = `${model.info?.alias}.${parentKey} = ${ChildtableName}.${childKey} `;
        joinInfo.table = ChildtableName;
        joinInfo.alias = as;
        joinInfoList.push(joinInfo);
        if (R.isEmpty(isJoin[key]) === false) {
            const self = model.info?.childNode.find(
                (v) => v.name === ChildtableName,
            );
            if (self) {
                const childBin: CreateDynamicSqlDto = {
                    name: self.name,
                    alias: self.alias,
                    isJoin: isJoin[key],
                    info: self,
                };
                join(childBin, index, fields, sql);
            }
        }
    });
    if (model.fields?.where) {
        const result = where(
            model.fields.where,
            index,
            fields,
            operation,
            joinInfoList,
        );
        orderValue.concat(result.orderValue);
        sql.where(result.query, result.params);
    }

    return { orderValue };
}

function order(
    model: CreateDynamicSqlDto,
    orderBy: string[] | string,
    orderValue: string[] = [],
) {
    if (model.pk && (!orderBy || !orderBy.length)) {
        orderBy = [model.pk];
    }
    let result: OrderByCondition | string = {};
    if (!R.isNil(orderBy) && !Array.isArray(orderBy)) orderBy = [orderBy];
    if (!orderBy) throw `define Directives model first (@${model.name})`;
    orderBy.map((order) => {
        const [key, direction] = order.split('__');
        if (typeof result === 'string') return;
        switch (key) {
            case 'rand': {
                result = 'random()';
                break;
            }
            case 'SIMILARITY': {
                result = 'random()';
                break;
            }
            default: {
                if (direction === 'ASC' || direction === 'DESC') {
                    result[`${model.alias}.${key}`] = direction;
                    (model.selectSet as String[]).push(`${model.alias}.${key}`);
                } else if (direction === 'SIMILARITY' && orderValue.length) {
                    result[`MAX(ts_rank_cd(${orderValue}) )`] = 'DESC';
                } else {
                    result[`${model.alias}.${key}`] = 'ASC';
                    (model.selectSet as String[]).push(`${model.alias}.${key}`);
                }
                break;
            }
        }
    });

    (model.selectSet as String[]) = R.uniq(model.selectSet as String[]);
    return result;
}

function group<model extends ObjectLiteral>(
    selectSet: string | string[] = '*',
    sql: SelectQueryBuilder<model>,
) {
    if (!R.isNil(selectSet) && !Array.isArray(selectSet))
        selectSet = [selectSet];
    let i = 0;
    selectSet.map((key) => {
        let triggerFromGroupBy: 'groupBy' | 'addGroupBy' = 'groupBy';

        let triggerFromSelect: 'select' | 'addSelect' = !sql.expressionMap
            .selects.length
            ? 'select'
            : 'addSelect';
        if (i !== 0) {
            triggerFromGroupBy = 'addGroupBy';
            triggerFromSelect = 'addSelect';
        }
        sql[triggerFromGroupBy](key);
        sql[triggerFromSelect](
            key,
            key.includes('.') ? key.split('.')[1] : key,
        );
        ++i;
    });
    return;
}
