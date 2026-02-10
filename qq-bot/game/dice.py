from __future__ import annotations

import random


def roll_6d4() -> list[int]:
    return [random.randint(1, 4) for _ in range(6)]


def apply_burnout(dice: list[int], burnout: int) -> tuple[list[int], int]:
    """Apply burnout: convert 3s to random non-3 values.

    Returns (new_dice, unconsumed_burnout).
    """
    result = list(dice)
    remaining = burnout
    non_three = [1, 2, 4]

    for i in range(len(result)):
        if remaining <= 0:
            break
        if result[i] == 3:
            result[i] = random.choice(non_three)
            remaining -= 1

    return result, remaining


def count_successes(dice: list[int]) -> int:
    return sum(1 for d in dice if d == 3)


def count_non_successes(dice: list[int]) -> int:
    return sum(1 for d in dice if d != 3)
