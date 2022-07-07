import R from 'ramda';
import {
    Repository,
    EntityTarget,
    EntityManager,
    InsertResult,
    QueryRunner,
    SelectQueryBuilder,
    DataSource,
    FindOptionsWhere,
    UpdateResult,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { where as makeWhere } from './sql/typeorm';

import { BuildDynamicSqlService } from './build-dynamic-sql.service';
import { CustomResolveInfo } from './dto/customGraphQLObjectType.dto';
import { Operation, OperationNode, SqlQuery, SqlRunner } from './dto/sql.dto';
import { GqlError } from './filters/all-exceptions.filter';
import { RunnerFunc, IRunnerFunc } from './runnerFuc';

export interface IBaseSqlService {
    executeRunner(sql: SqlQuery): Promise<any>;
    add(
        parent: SqlQuery,
        child?: SqlQuery | SqlQuery[],
        withOutFnc?: boolean,
    ): SqlQuery;
    add(parent: SqlQuery, child?: SqlQuery | SqlQuery[]): IRunnerFunc;
}

export class BaseSqlService<Model>
    extends Repository<Model>
    implements IBaseSqlService
{
    public repository: Repository<Model>;
    public db: DataSource;
    public entitny: EntityTarget<Model>;
    public buildDynamicSqlService: BuildDynamicSqlService<Model>;

    constructor(target: EntityTarget<Model>, manager: EntityManager) {
        super(target, manager);

        this.buildDynamicSqlService = new BuildDynamicSqlService<Model>();
    }
    private getMaster() {
        return this.db.createQueryRunner('master');
    }

    private getChild() {
        return this.db.createQueryRunner('slave');
    }
    get getQueryRunner() {
        return this.db.createQueryRunner();
    }

    get getSqlModel(): SqlQuery {
        return new SqlRunner({
            name: this.tableName,
            alias: this.tableName,
            operation: Operation.Select,
            children: [],
        });
    }

    add(parent: SqlQuery, child?: SqlQuery | SqlQuery[]): IRunnerFunc;
    add(
        parent: SqlQuery,
        child?: SqlQuery | SqlQuery[],
        withOutFnc?: boolean,
    ): SqlQuery;
    add(
        parent?: SqlQuery,
        child?: SqlQuery | SqlQuery[],
        withOutFnc: boolean = false,
    ): SqlQuery | IRunnerFunc {
        if (child) {
            if (!parent.children) parent.children = [];
            parent!.children = parent.children.concat(child);
        }
        if (withOutFnc) return parent;
        return new RunnerFunc(this, parent);
    }

    // get Model
    get tableName(): string {
        return this.repository.metadata.givenTableName
            ? this.repository.metadata.givenTableName
            : '';
    }

    get pkName(): string {
        return this.repository.metadata.primaryColumns[0].propertyAliasName;
    }

    public getOption(_isDefault?: boolean) {
        return this.repository.createQueryBuilder(this.tableName);
    }

    makeInsertModel(dataModel: Model[] | Model, parentKey?: string) {
        const node = this.getSqlModel;
        node.operation = Operation.Insert;
        if (parentKey) node.parentKeyName = parentKey;
        node.typeorm = this.getOption().insert().values(dataModel);
        return node;
    }

    makeDeleteModel<Entity>(
        where: FindOptionsWhere<Entity>,
        parentKey?: string,
    ) {
        const node = this.getSqlModel;
        node.operation = Operation.Delete;
        if (parentKey) node.parentKeyName = parentKey;
        node.typeorm = this.getOption().delete().where(where);
        node.typeormForGetter = this.getOption().where(where);
        return node;
    }

    async insertTransaction(
        dataModel: Model[] | Model,
        manager?: EntityManager,
    ): Promise<InsertResult> {
        const sql: EntityManager = manager
            ? manager
            : this.db.createQueryRunner().manager;
        try {
            if (dataModel)
                return await sql
                    .getRepository(this.repository.target)
                    .createQueryBuilder()
                    .insert()
                    .into(this.repository.target)
                    .values(dataModel)
                    .execute()
                    .then((_e) => {
                        return _e;
                    });
        } catch (e) {
            throw e;
        } finally {
            if (!manager) {
                sql.release();
            }
        }
    }

    async updateTransaction<T>(
        option: T,
        dataModel: QueryDeepPartialEntity<Model>,
        manager?: EntityManager,
    ): Promise<UpdateResult> {
        const sql: EntityManager = manager
            ? manager
            : this.db.createQueryRunner().manager;
        try {
            const where = makeWhere(option);

            if (dataModel)
                return await sql
                    .getRepository(this.repository.target)
                    .createQueryBuilder()
                    .update()
                    .set({
                        ...dataModel,
                    })
                    .where(where.query, where.params)
                    .execute()
                    .then((_e) => {
                        return _e;
                    });
        } catch (e) {
            throw e;
        } finally {
            if (!manager) {
                sql.release();
            }
        }
    }

    async deleteTransaction(whereModel: Model, manager?: EntityManager) {
        const sql: EntityManager = manager
            ? manager
            : this.db.createQueryRunner().manager;
        try {
            const where = makeWhere(whereModel, null);
            if (whereModel)
                return await sql
                    .getRepository(this.repository.target)
                    .createQueryBuilder()
                    .delete()
                    .from(this.repository.target)
                    .where(where.query, where.params)
                    .execute();
        } catch (e) {
            throw e;
        } finally {
            if (!manager) {
                sql.release();
            }
        }
    }

    private bulkChildren(child: SqlQuery, parentData: Record<string, any>) {
        if (child.typeorm.expressionMap.valuesSet) {
            for (const [key, value] of Object.entries(
                child.typeorm.expressionMap.valuesSet,
            )) {
                if (value === '$parent$') {
                    if (child.typeormForGetter) {
                        child.typeormForGetter.expressionMap.valuesSet[key] =
                            parentData[child.parentKeyName];
                    }
                    child.typeorm.expressionMap.valuesSet[key] =
                        parentData[child.parentKeyName];
                }
            }
            for (const [key, value] of Object.entries(
                child.typeorm.expressionMap.parameters,
            )) {
                if (value === '$parent$') {
                    if (child.typeormForGetter) {
                        child.typeormForGetter.expressionMap.parameters[key] =
                            parentData[child.parentKeyName];
                    }
                    child.typeorm.expressionMap.parameters[key] =
                        parentData[child.parentKeyName];
                }
            }
        }

        return child;
    }

    private async bulkSelect(model: SqlQuery, runner?: QueryRunner) {
        const queryRunner = runner ?? this.db.createQueryRunner();
        try {
            if (!runner) await queryRunner.startTransaction();
            model.typeorm.setQueryRunner(queryRunner);
            if (model.typeormForGetter)
                model.typeormForGetter!.setQueryRunner(queryRunner);
            const selfData = model.typeormForGetter
                ? await model.typeormForGetter!.execute()
                : await model.typeorm!.execute();
            if (selfData.length && model.children?.length) {
                const parentData = selfData[0];
                await Promise.all(
                    model.children.map(async (node: SqlQuery) => {
                        const child = this.bulkChildren(node, parentData);
                        await this.execute(child, queryRunner);
                    }),
                );
            }
            if (!runner) await queryRunner.commitTransaction();
            return selfData;
        } catch (e) {
            if (!runner) await queryRunner.rollbackTransaction();
            throw e;
        } finally {
            if (!runner) await queryRunner.release();
        }
    }

    private async bulkInsertOrUpdate(model: SqlQuery, runner?: QueryRunner) {
        const queryRunner = runner ?? this.db.createQueryRunner();
        try {
            if (!runner) await queryRunner.startTransaction();
            model.typeorm.setQueryRunner(queryRunner);
            if (model.typeormForGetter)
                model.typeormForGetter!.setQueryRunner(queryRunner);
            const self = await model.typeorm!.execute();
            const parentData = self.identifiers
                ? self.identifiers[0]
                : (await model.typeormForGetter.execute())[0];
            if (model.children?.length) {
                await Promise.all(
                    model.children.map(async (node: SqlQuery) => {
                        const child = this.bulkChildren(node, parentData);

                        await this.execute(child, queryRunner);
                    }),
                );
            }
            if (!runner) await queryRunner.commitTransaction();
            return parentData;
        } catch (e) {
            if (!runner) await queryRunner.rollbackTransaction();
            throw e;
        } finally {
            if (!runner) await queryRunner.release();
        }
    }

    private async bulkDelete(model: SqlQuery, runner?: QueryRunner) {
        const queryRunner = runner ?? this.db.createQueryRunner();
        try {
            if (!runner) await queryRunner.startTransaction();
            model.typeorm.setQueryRunner(queryRunner);
            if (model.typeormForGetter)
                model.typeormForGetter.setQueryRunner(queryRunner);
            const parentData = await model.typeormForGetter.execute();
            if (parentData?.length) {
                await model.typeorm.execute();
                if (model.children?.length) {
                    await Promise.all(
                        model.children.map(async (node: SqlQuery) => {
                            const child = this.bulkChildren(node, parentData);
                            await this.execute(child, queryRunner);
                        }),
                    );
                }
            }
            if (!runner) await queryRunner.commitTransaction();
            return parentData;
        } catch (e) {
            if (!runner) await queryRunner.rollbackTransaction();
            throw e;
        } finally {
            if (!runner) await queryRunner.release();
        }
    }

    private async execute(model: SqlQuery, queryRunner?: QueryRunner) {
        try {
            switch (model.operation) {
                case Operation.Insert: {
                    return await this.bulkInsertOrUpdate(model, queryRunner);
                }
                case Operation.Select: {
                    return await this.bulkSelect(model, queryRunner);
                }
                case Operation.Update: {
                    return await this.bulkInsertOrUpdate(model, queryRunner);
                }
                case Operation.Delete: {
                    return await this.bulkDelete(model, queryRunner);
                }

                default:
                    break;
            }
        } catch (e) {
            throw new GqlError(e, '400');
        }
    }

    async executeRunner(sql: SqlQuery): Promise<any> {
        return await this.execute(sql);
    }

    getQuery<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ) {
        const worker = this.buildDynamicSqlService.normalFindAllWithOutExecute<
            T,
            Parent
        >(customResolveInfo, fields, sql, parent);
        return worker;
        // TODO: error case throw : only db error
    }

    async getData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<Model[]>;
    async getData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<SqlQuery>;
    async getData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute: boolean = true,
    ) {
        const result = this.buildDynamicSqlService.normalFindAllWithOutExecute<
            T,
            Parent
        >(customResolveInfo, fields, sql, parent);

        if (!withExecute) return result[0];

        const raw = await this.executeRunner(result[0]);
        return raw;
        // TODO: error case throw : only db error
    }

    async getCount<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<number>;
    async getCount<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<SqlQuery>;
    async getCount<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute: boolean = true,
    ): Promise<number | SqlQuery> {
        const result = this.buildDynamicSqlService.normalFindAllWithOutExecute<
            T,
            Parent
        >(customResolveInfo, fields, sql, parent);

        if (!withExecute) return result[0];

        const raw = (result[0]?.typeorm as SelectQueryBuilder<any>).getCount();

        return raw;
        // TODO: error case throw : only db error
    }

    async createData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<Model>;
    async createData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<SqlQuery>;
    async createData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute: boolean = true,
    ): Promise<Model | SqlQuery | Boolean> {
        const args = { ...fields };
        const result = this.buildDynamicSqlService.insertWithOutExecute<
            T,
            Parent
        >(customResolveInfo, args, sql, parent);

        const currentNode = result[0];
        if (!withExecute) return currentNode;
        const pk = await this.executeRunner(currentNode);
        const raw = await this.repository.findOneBy(pk);
        return setReturnType<Model>(
            currentNode.gqlNode.returnType,
            await this.repository.findOneBy(pk),
        );
    }

    async updateData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<Boolean>;
    async updateData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<Model>;
    async updateData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<SqlQuery>;
    async updateData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute: boolean = true,
    ): Promise<Model | SqlQuery | Boolean> {
        const alias = customResolveInfo.fieldNodes[0].alias;
        const args = { ...fields };
        (customResolveInfo.fieldNodes[0].alias as any) = undefined;
        const result = this.buildDynamicSqlService.updateWithOutExecute<
            T,
            Parent
        >(customResolveInfo, args, sql, parent);
        (customResolveInfo.fieldNodes[0].alias as any) = alias;

        const currentNode = result[0];
        if (!withExecute) return currentNode;

        const raw = await this.executeRunner(currentNode);

        return setReturnType<Model>(currentNode.gqlNode.returnType, raw);
    }

    async deleteData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
    ): Promise<Boolean>;
    async deleteData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<SqlQuery>;
    async deleteData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute?: boolean,
    ): Promise<T | T[]>;
    async deleteData<T, Parent>(
        customResolveInfo: CustomResolveInfo,
        fields: T,
        parent?: Parent,
        sql?: EntityManager,
        withExecute: boolean = true,
    ): Promise<Boolean | SqlQuery | T | T[]> {
        const args = { ...fields };
        const alias = customResolveInfo.fieldNodes[0].alias;
        (customResolveInfo.fieldNodes[0].alias as any) = undefined;
        const result = this.buildDynamicSqlService.deleteWithOutExecute<
            T,
            Parent
        >(customResolveInfo, args, sql, parent);
        (customResolveInfo.fieldNodes[0].alias as any) = alias;
        const currentNode = result[0];
        if (!withExecute) return currentNode;

        const raw = await this.executeRunner(currentNode);

        return setReturnType<T>(currentNode.gqlNode.returnType, raw);
    }
}

function setReturnType<T>(
    returnType: OperationNode['returnType'],
    raw: T | T[],
) {
    const thrower = (e?: Error) => {
        if (e) throw new GqlError(`target is not exist (@${e})`, '403');
        throw new GqlError(`target is not exist `, '403');
    };

    try {
        switch (returnType) {
            case 'Array':
            case 'Object':
                return raw
                    ? Array.isArray(raw)
                        ? raw[0] ?? thrower()
                        : raw
                    : thrower();
            case 'Boolean':
                return raw
                    ? Array.isArray(raw)
                        ? raw.length
                            ? true
                            : thrower()
                        : true
                    : thrower();
            default:
                break;
        }
    } catch (e) {
        thrower(e);
    }

    return true;
}
