from __future__ import annotations

from game.dice import count_successes, count_non_successes


def is_triple_sublimation(dice: list[int]) -> bool:
    return count_successes(dice) == 3


def calculate_chaos(dice: list[int], unconsumed_burnout: int) -> int:
    if is_triple_sublimation(dice):
        return 0
    return count_non_successes(dice) + unconsumed_burnout
