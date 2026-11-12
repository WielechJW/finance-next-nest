import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CategoryResponse } from './category-response.js';
import type { ListCategoriesDto } from './dto/list-categories.dto.js';

const categorySelect = {
  id: true,
  name: true,
  type: true,
} satisfies Prisma.CategorySelect;

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(input: ListCategoriesDto): Promise<CategoryResponse[]> {
    try {
      return await this.prisma.category.findMany({
        where: input.type === undefined ? {} : { type: input.type },
        orderBy: { id: 'asc' },
        select: categorySelect,
      });
    } catch {
      this.logger.error('Nie udało się odczytać kategorii.');
      throw new InternalServerErrorException('Nie udało się pobrać kategorii.');
    }
  }
}
