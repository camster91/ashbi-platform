// Preloaded into every Node test-runner child by scripts/run-node-tests.mjs.
//
// With default process isolation, each test file runs in a child process
// whose stdout carries the runner's v8-serialized report frames. Plain text
// written to that same stdout (console.log progress lines in tests, pretty
// log output) is interleaved with the frames, and Node 22's parent-side
// frame parser intermittently mis-splits such mixed chunks, failing the file
// with "Unable to deserialize cloned data due to invalid or unsupported
// version" (or hanging). Keep the frame channel binary-only by sending
// console output from test children to stderr, which the runner forwards
// verbatim.
if (process.env.NODE_TEST_CONTEXT) {
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
}
