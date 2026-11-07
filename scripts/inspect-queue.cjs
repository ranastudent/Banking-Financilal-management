const { Queue } = require("bullmq");

async function inspectQueue() {
  const queue = new Queue("banking-background", {
    connection: {
      host: "127.0.0.1",
      port: 6380,
    },
  });

  try {
    await queue.waitUntilReady();

    // =====================================
    // 1. QUEUE COUNTS
    // =====================================

    console.log("\n========== QUEUE COUNTS ==========\n");

    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
      "waiting-children"
    );

    console.table(counts);

    // =====================================
    // 2. FAILED JOB DETAILS
    // =====================================

    console.log("\n========== FAILED JOB DETAILS ==========\n");

    const failedJobs = await queue.getJobs(
      ["failed"],
      0,
      99,
      true
    );

    console.log("Total failed jobs:", failedJobs.length);

    console.table(
      failedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        failedReason: job.failedReason,
        timestamp: new Date(job.timestamp).toISOString(),
      }))
    );

    // =====================================
    // 3. FAILED JOB STACK TRACES
    // =====================================

    console.log("\n========== FAILED JOB ERROR DETAILS ==========\n");

    for (const job of failedJobs) {
      console.log("\n-------------------------------------");
      console.log("Job ID:", job.id);
      console.log("Job Name:", job.name);
      console.log("Attempts:", job.attemptsMade);
      console.log("Failed Reason:", job.failedReason);

      if (job.stacktrace?.length) {
        console.log("Stack Trace:");
        console.log(job.stacktrace.slice(0, 2).join("\n"));
      }
    }

    // =====================================
    // 4. DELAYED JOB DETAILS
    // =====================================

    console.log("\n========== DELAYED JOB DETAILS ==========\n");

    const delayedJobs = await queue.getJobs(
      ["delayed"],
      0,
      99,
      true
    );

    console.log("Total delayed jobs:", delayedJobs.length);

    console.table(
      delayedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        delayMs: job.delay,
        failedReason: job.failedReason || "N/A",
      }))
    );

    // =====================================
    // 5. FAILURE SUMMARY BY JOB TYPE
    // =====================================

    console.log("\n========== FAILURE SUMMARY ==========\n");

    const failureSummary = {};

    for (const job of failedJobs) {
      failureSummary[job.name] =
        (failureSummary[job.name] || 0) + 1;
    }

    console.table(failureSummary);

    // =====================================
    // 6. DELAYED JOB SUMMARY
    // =====================================

    console.log("\n========== DELAYED JOB SUMMARY ==========\n");

    const delayedSummary = {};

    for (const job of delayedJobs) {
      delayedSummary[job.name] =
        (delayedSummary[job.name] || 0) + 1;
    }

    console.table(delayedSummary);

    console.log("\n========== INSPECTION COMPLETED ==========\n");

  } catch (error) {
    console.error("Queue inspection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await queue.close();
  }
}

inspectQueue();