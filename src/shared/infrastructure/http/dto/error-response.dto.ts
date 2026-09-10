import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({
    description: 'Código de estado HTTP',
    example: 400,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'Mensaje descriptivo del error',
    example: 'query must have a value',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  message!: string | string[];

  @ApiProperty({
    description: 'Nombre del error HTTP',
    example: 'Bad Request',
  })
  error!: string;
}
