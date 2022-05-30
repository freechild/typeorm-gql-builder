import { IsInt, Min, Max, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export interface EdgeForm<T> {
    data?: T[];
    edge?: edgeDto;
    status?: boolean;
    message?: string;
    statusCode?: number;
}

export class edgeDto {
    hasNextPage = false;
    hasPreviousPage = false;
    currentPage = 1;
    pageCount = 1;
    totalCount = 0;
}

export type P = keyof PaginationDto;

export class PaginationDto {
    @IsInt()
    @Min(0)
    @Max(100)
    count?: number = 10;

    @IsInt()
    @Min(1)
    page?: number = 1;
    // @IsEmpty()

    @IsOptional()
    @Transform((obj) => {
        if (obj.value === 'true' || Boolean(Number(obj.value.isPublic))) {
            return true;
        }

        return false;
    })
    @IsBoolean()
    isPage?: any = true;
}

export enum Range {
    DAILY = 'day',
    WEEKLY = 'week',
    MONTHLY = 'month',
}
