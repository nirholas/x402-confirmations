/**
 * Per-route invocation contracts published inside every x402 402 challenge as
 * `accepts[].outputSchema` — `input` tells an agent how to build the request
 * (method, path/query params, JSON body fields), `output` is the JSON Schema of
 * the successful response body. An agent that has never seen this API can
 * therefore call it correctly straight from the challenge it just received.
 *
 * Derived from `openapi.json`, so the runtime challenge (which the x402scan
 * discovery spec treats as authoritative) can never contradict the published
 * spec. Keys match the paywall route map exactly: `"<VERB> /path"`, with `*`
 * standing in for a path parameter.
 */

/** The `outputSchema` value carried by every accept entry of a paid route. */
export type RouteSchema = {
  /** How to invoke the route: HTTP method, parameters, request body fields. */
  input: Record<string, unknown>;
  /** JSON Schema of the 2xx response body. */
  output: Record<string, unknown>;
};

/** Keyed exactly like the paywall route map — spread into each route entry. */
export const ROUTE_SCHEMAS: Record<string, { outputSchema: RouteSchema }> = {
  "POST /track": {
    outputSchema: {
      "input": {
        "type": "http",
        "method": "POST",
        "path": "/track",
        "bodyType": "json",
        "bodyFields": {
          "confirmation": {
            "type": "object",
            "description": "Structured confirmation JSON from any merchant"
          },
          "rawText": {
            "type": "string",
            "description": "Freeform confirmation text (e.g. pasted email)"
          },
          "type": {
            "type": "string",
            "enum": [
              "restaurant",
              "hotel",
              "order",
              "flight",
              "appointment",
              "generic"
            ]
          },
          "merchant": {
            "type": "string"
          }
        }
      },
      "output": {
        "type": "object",
        "properties": {
          "record": {
            "type": "object",
            "properties": {
              "confirmationId": {
                "type": "string"
              },
              "type": {
                "type": "string",
                "enum": [
                  "restaurant",
                  "hotel",
                  "order",
                  "flight",
                  "appointment",
                  "generic"
                ]
              },
              "merchant": {
                "type": "string"
              },
              "reference": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "when": {
                "type": "object",
                "properties": {
                  "start": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "end": {
                    "type": "string",
                    "format": "date-time"
                  }
                },
                "required": [
                  "start"
                ]
              },
              "where": {
                "type": "string"
              },
              "party": {
                "type": "number"
              },
              "amount": {
                "type": "object",
                "properties": {
                  "total": {
                    "type": "string"
                  },
                  "currency": {
                    "type": "string"
                  }
                }
              },
              "status": {
                "type": "string",
                "enum": [
                  "confirmed",
                  "amended",
                  "cancelled"
                ]
              },
              "sourceFingerprint": {
                "type": "string"
              },
              "normalizedAt": {
                "type": "string",
                "format": "date-time"
              },
              "extras": {
                "type": "object"
              }
            }
          },
          "ics": {
            "type": "string",
            "description": "base64 RFC 5545 invite"
          },
          "ownerToken": {
            "type": "string"
          },
          "signature": {
            "type": "string"
          }
        }
      }
    },
  },
  "GET /status/*": {
    outputSchema: {
      "input": {
        "type": "http",
        "method": "GET",
        "path": "/status/{id}",
        "pathParams": {
          "id": {
            "type": "string"
          }
        },
        "pathParamsRequired": [
          "id"
        ]
      },
      "output": {
        "type": "object",
        "properties": {
          "confirmationId": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "confirmed",
              "amended",
              "cancelled"
            ]
          },
          "temporal": {
            "type": "string",
            "enum": [
              "upcoming",
              "imminent",
              "in-progress",
              "past"
            ]
          },
          "minutesUntilStart": {
            "type": [
              "number",
              "null"
            ]
          },
          "when": {
            "type": "object"
          },
          "lastUpdated": {
            "type": "string",
            "format": "date-time"
          },
          "history": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "at": {
                  "type": "string"
                },
                "status": {
                  "type": "string"
                },
                "note": {
                  "type": "string"
                }
              }
            }
          },
          "signature": {
            "type": "string"
          }
        }
      }
    },
  },
};
