import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../users/normalize-email.js';

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsString({ message: 'Adres e-mail musi być tekstem.' })
  @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' })
  @MaxLength(254, { message: 'Adres e-mail może mieć najwyżej 254 znaki.' })
  email!: string;

  @IsString({ message: 'Hasło musi być tekstem.' })
  @MinLength(15, { message: 'Hasło musi mieć co najmniej 15 znaków.' })
  @MaxLength(128, { message: 'Hasło może mieć najwyżej 128 znaków.' })
  password!: string;
}
