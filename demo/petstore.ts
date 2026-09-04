/**
 * OpenAPI 3.0 Petstore fixture used by the demo.
 */
export const petstoreDocument = {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Swagger Petstore",
    description:
      "A sample API that demonstrates OpenAPI 3.0 features through a pet store.",
    termsOfService: "https://swagger.io/terms/",
    contact: {
      name: "Swagger API Team",
      email: "apiteam@swagger.io",
      url: "https://swagger.io",
    },
    license: {
      name: "Apache 2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
  },
  servers: [
    {
      url: "https://petstore.swagger.io/v2",
      description: "Swagger Petstore server",
    },
  ],
  paths: {
    "/pets": {
      get: {
        summary: "List pets",
        description: "Returns the pets that are visible to the current user.",
        operationId: "findPets",
        parameters: [
          {
            name: "tags",
            in: "query",
            description: "Tags used to filter the results.",
            required: false,
            style: "form",
            explode: true,
            schema: {
              type: "array",
              items: {
                type: "string",
              },
            },
            example: ["friendly", "small"],
          },
          {
            name: "limit",
            in: "query",
            description: "Maximum number of results to return.",
            required: false,
            schema: {
              type: "integer",
              format: "int32",
              minimum: 1,
              maximum: 100,
              default: 20,
            },
            example: 10,
          },
        ],
        responses: {
          "200": {
            description: "A list of pets.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Pet",
                  },
                },
              },
            },
          },
          default: {
            $ref: "#/components/responses/UnexpectedError",
          },
        },
      },

      post: {
        summary: "Create a pet",
        description:
          "Creates a pet in the store. Pets with duplicate names are allowed.",
        operationId: "addPet",
        requestBody: {
          description: "The pet to add.",
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/NewPet",
              },
              example: {
                name: "Milo",
                tag: "friendly",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The pet was created.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Pet",
                },
              },
            },
          },
          default: {
            $ref: "#/components/responses/UnexpectedError",
          },
        },
      },
    },

    "/pets/{id}": {
      parameters: [
        {
          $ref: "#/components/parameters/PetId",
        },
      ],

      get: {
        summary: "Get a pet",
        description: "Returns the pet identified by the supplied ID.",
        operationId: "findPetById",
        responses: {
          "200": {
            description: "The requested pet.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Pet",
                },
              },
            },
          },
          "404": {
            description: "The pet was not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          default: {
            $ref: "#/components/responses/UnexpectedError",
          },
        },
      },

      delete: {
        summary: "Delete a pet",
        description: "Deletes the pet identified by the supplied ID.",
        operationId: "deletePet",
        responses: {
          "204": {
            description: "The pet was deleted.",
          },
          "404": {
            description: "The pet was not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          default: {
            $ref: "#/components/responses/UnexpectedError",
          },
        },
      },
    },
  },

  components: {
    parameters: {
      PetId: {
        name: "id",
        in: "path",
        description: "The ID of the pet.",
        required: true,
        schema: {
          type: "integer",
          format: "int64",
          minimum: 1,
        },
        example: 123,
      },
    },

    responses: {
      UnexpectedError: {
        description: "An unexpected error occurred.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
    },

    schemas: {
      Pet: {
        allOf: [
          {
            $ref: "#/components/schemas/NewPet",
          },
          {
            type: "object",
            required: ["id"],
            properties: {
              id: {
                type: "integer",
                format: "int64",
                description: "The unique pet ID.",
                example: 123,
              },
            },
          },
        ],
      },

      NewPet: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            description: "The pet name.",
            example: "Milo",
          },
          tag: {
            type: "string",
            description: "An optional classification tag.",
            example: "friendly",
          },
        },
      },

      Error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "integer",
            format: "int32",
            description: "The application-specific error code.",
            example: 404,
          },
          message: {
            type: "string",
            description: "A human-readable error message.",
            example: "Pet not found.",
          },
        },
      },
    },
  },
} as const;
