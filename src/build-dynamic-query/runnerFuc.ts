import { Operation, SqlQuery, SqlRunner } from './dto/sql.dto';
import { IBaseSqlService } from './base.service';

export interface IRunnerFunc {
    executeRunner(): Promise<any>;
}

export class RunnerFunc implements IRunnerFunc {
    runner: IBaseSqlService;
    parent: SqlQuery;
    constructor(runner: IBaseSqlService, parent: SqlQuery) {
        this.runner = runner;
        this.parent = parent;
    }
    executeRunner() {
        return this.runner.executeRunner(this.parent);
    }
}
