/**
 * Runtime knobs. A mutable object rather than a constant so tests can dial the
 * timeout down to milliseconds without mocking the fetch layer they're testing.
 */
export const requestConfig = {
  timeoutMs: 8_000,
}
