import {
    print,
    FieldNode,
    FragmentDefinitionNode,
    FragmentSpreadNode,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLSchema,
    OperationDefinitionNode,
} from 'graphql';
import * as R from 'ramda';
import { getDirective } from '@graphql-tools/utils';
import {
    CustomGraphQLObjectType,
    TableInfo,
} from '../dto/customGraphQLObjectType.dto';
import { OperationNode } from '../dto/sql.dto';

declare global {
    interface String {
        capitalize(): string;
    }
}

String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

export function getTableInfo(
    model: string | GraphQLOutputType,
    schema: GraphQLSchema,
    data?: Record<string, any>,
) {
    let target = '';
    if (typeof model !== 'string') {
        const result = getReturnModelInfo(model);
        target = result.name;
    } else {
        target = model;
    }
    const selfType = schema.getType(target);

    const info = getDirective(
        schema,
        selfType,
        'model',
    )?.[0] as CustomGraphQLObjectType;
    return {
        ...info,
        fields: (selfType as GraphQLObjectType).getFields(),
        relations: info?.relations ? R.uniq(info.relations) : undefined,
        data,
    } as TableInfo;
}

export function getReturnModelInfo(models: GraphQLOutputType) {
    const getModel = (model: any) => {
        if (model.ofType) return getModel(model.ofType);
        return model;
    };
    const ModelInfo: CustomGraphQLObjectType = getModel(models);
    return ModelInfo;
}

export function makeQuery({
    operation,
    fieldNodes,
    fragments,
    fields,
}: {
    operation: OperationDefinitionNode;
    fieldNodes: FieldNode[];
    fragments: {
        [key: string]: FragmentDefinitionNode;
    };
    fields: any;
}): OperationNode {
    const query = { ...R.clone(operation) };
    const customFieldNodes = R.clone(fieldNodes);
    const customFragments = R.clone(fragments);
    const fragmentsQuery: string[] = [];
    const usingKeys = findUsingValues(customFieldNodes, customFragments);

    if (customFragments) {
        Object.values(customFragments).map((v) => {
            if (usingKeys.fragmentsKey.includes(v.name.value))
                fragmentsQuery.push(print(v));
        });
    }

    query.variableDefinitions = query.variableDefinitions.filter((i) =>
        usingKeys.valuesKey.includes(i.variable.name.value),
    );

    query.selectionSet.selections = customFieldNodes;
    return { query, fragmentsQuery, fragments, fields };
}

function findUsingValues(
    node: FieldNode[] | FragmentSpreadNode[],
    fragments?: {
        [key: string]: FragmentDefinitionNode;
    },
) {
    let valuesKey = [];
    let fragmentsKey = [];

    node.map((v: FieldNode | FragmentSpreadNode) => {
        let target: FieldNode[];
        if (v.kind !== 'FragmentSpread') {
            v.arguments.map((arg) => {
                if (arg.value.kind === 'Variable')
                    valuesKey.push(arg.value.name.value);
            });
            if (v.selectionSet?.selections) {
                target = v.selectionSet.selections as FieldNode[];
            }
        } else {
            fragmentsKey.push(v.name.value);
            target = fragments[v.name.value].selectionSet
                .selections as FieldNode[];
        }
        if (target) {
            target.map((i: any, idx) => {
                if (!i.selectionSet) delete i.alias;
                // Check:
                else {
                    delete target[idx];
                }
            });
            const result = findUsingValues(target, fragments);
            valuesKey = valuesKey.concat(result.valuesKey);
            fragmentsKey = fragmentsKey.concat(result.fragmentsKey);
        }
    });
    return {
        valuesKey: R.uniq(valuesKey),
        fragmentsKey: R.uniq(fragmentsKey),
    };
}
