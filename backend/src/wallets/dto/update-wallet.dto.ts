import { Transform } from 'class-transformer';
import { IsString, Length, Matches, ValidateIf } from 'class-validator';

export class UpdateWalletDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Nazwa portfela musi być tekstem.' })
  @Length(1, 100, { message: 'Nazwa portfela musi mieć od 1 do 100 znaków.' })
  name?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString({ message: 'Saldo początkowe musi być tekstem.' })
  @Matches(/^-?(?:0|[1-9]\d{0,11})\.\d{2}$/, {
    message:
      'Podaj saldo z kropką i dwoma miejscami po przecinku, od -999999999999.99 do 999999999999.99.',
  })
  openingBalance?: string;
}
