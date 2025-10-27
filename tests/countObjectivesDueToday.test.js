const { parisContext, __testables } = require("../functions/index.js");

const { countObjectivesDueToday } = __testables;

describe("countObjectivesDueToday", () => {
  function makeFetcher(map) {
    return jest.fn(async (uid, monthKey) => map[monthKey] || []);
  }

  test("counts objectives stored with Paris-midnight ISO strings and timestamps", async () => {
    const context = parisContext(new Date("2024-07-15T08:00:00.000Z"));
    const monthKey = context.dateIso.slice(0, 7);

    const reminderIso = "2024-07-15T00:00:00+02:00";
    const reminderTimestamp = {
      toDate: () => new Date("2024-07-15T00:00:00+02:00"),
    };

    const fetcher = makeFetcher({
      [monthKey]: [
        { id: "iso", notifyAt: reminderIso },
        { id: "timestamp", notifyAt: reminderTimestamp },
        { id: "other", notifyAt: "2024-07-16T00:00:00+02:00" },
      ],
    });
    const reminderFetcher = jest.fn(async () => []);

    const count = await countObjectivesDueToday("user", context, {
      fetchObjectivesByMonth: fetcher,
      fetchObjectivesByReminder: reminderFetcher,
    });
    expect(count).toBe(2);
    expect(fetcher).toHaveBeenCalled();
    expect(reminderFetcher).toHaveBeenCalledWith("user", context.dateIso);
  });

  test("counts objectives for the Paris first day of a month", async () => {
    const context = parisContext(new Date("2024-07-31T22:15:00.000Z"));
    const monthKey = context.dateIso.slice(0, 7);
    const previousMonthKey = "2024-07";

    const fetcher = makeFetcher({
      [monthKey]: [
        {
          id: "first-day",
          notifyAt: "2024-08-01T00:00:00+02:00",
        },
      ],
      [previousMonthKey]: [],
    });
    const reminderFetcher = jest.fn(async () => []);

    const count = await countObjectivesDueToday("user", context, {
      fetchObjectivesByMonth: fetcher,
      fetchObjectivesByReminder: reminderFetcher,
    });
    expect(count).toBe(1);
    expect(fetcher).toHaveBeenCalledWith("user", monthKey);
    expect(fetcher).toHaveBeenCalledWith("user", previousMonthKey);
    expect(reminderFetcher).toHaveBeenCalledWith("user", context.dateIso);
  });

  test("counts objectives fetched by reminder fields when monthKey is outdated", async () => {
    const context = parisContext(new Date("2024-07-26T08:00:00.000Z"));
    const monthKey = context.dateIso.slice(0, 7);

    const fetcher = makeFetcher({
      [monthKey]: [],
    });

    const reminderObjective = {
      id: "reminder-only",
      monthKey: "2024-05",
      notifyAt: "2024-07-26T00:00:00+02:00",
    };

    const reminderFetcher = jest.fn(async () => [reminderObjective]);

    const count = await countObjectivesDueToday("user", context, {
      fetchObjectivesByMonth: fetcher,
      fetchObjectivesByReminder: reminderFetcher,
    });

    expect(count).toBe(1);
    expect(fetcher).toHaveBeenCalledWith("user", monthKey);
    expect(reminderFetcher).toHaveBeenCalledWith("user", context.dateIso);
  });

  test("ignores email-only objectives when counting push reminders", async () => {
    const context = parisContext(new Date("2024-07-15T08:00:00.000Z"));
    const monthKey = context.dateIso.slice(0, 7);

    const fetcher = makeFetcher({
      [monthKey]: [
        { id: "push", notifyAt: "2024-07-15", notifyChannel: "push" },
        { id: "email", notifyAt: "2024-07-15", notifyChannel: "email" },
        { id: "both", notifyAt: "2024-07-15", notifyChannel: "both" },
      ],
    });

    const reminderFetcher = jest.fn(async () => []);

    const count = await countObjectivesDueToday("user", context, {
      fetchObjectivesByMonth: fetcher,
      fetchObjectivesByReminder: reminderFetcher,
    });

    expect(count).toBe(2);
    expect(fetcher).toHaveBeenCalledWith("user", monthKey);
    expect(reminderFetcher).toHaveBeenCalledWith("user", context.dateIso);
  });
});
