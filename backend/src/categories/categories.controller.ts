import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CategoriesService } from './categories.service.js';
import type { CategoryResponse } from './category-response.js';
import { ListCategoriesDto } from './dto/list-categories.dto.js';

@Controller('categories')
@UseGuards(SessionAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() input: ListCategoriesDto): Promise<CategoryResponse[]> {
    return this.categories.list(input);
  }
}
