import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';

export class InvestmentNameDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  name!: string;
}

export class UpdateInvestmentAccountDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  name?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  archived?: boolean;
}
