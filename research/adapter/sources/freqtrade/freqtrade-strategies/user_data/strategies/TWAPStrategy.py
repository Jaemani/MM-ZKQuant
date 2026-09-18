from datetime import datetime, timedelta

import pandas as pd

from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy
import talib.abstract as ta


class TWAPStrategy(IStrategy):
    """
    TWAP (Time-Weighted Average Price) execution on both entry and exit.
    this strategy breaks orders into equal time-based slices to minimize market impact
    The entry and exit signals are examples and should be adapted to your strategy.
    
    - twap_num_slices: desired number of execution slices.
    - twap_interval_minutes: time between execution slices.
    """

    timeframe = "15m"
    stoploss = -0.10
    minimal_roi = {"0": 0.02}
    process_only_new_candles = True
    startup_candle_count = 30
    can_short = True
    position_adjustment_enable = True

    twap_num_slices = 10             # number of slices
    twap_interval_minutes = 1      # interval between slices


    def populate_indicators(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe["rsi"] = ta.RSI(dataframe)
        return dataframe

    def populate_entry_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:

        dataframe.loc[
            (dataframe["rsi"] < 45) & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1

        # Short entry
        dataframe.loc[
            (dataframe["rsi"] > 55) & (dataframe["volume"] > 0),
            "enter_short",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:

        return dataframe





    def should_exit_partially(self, trade: Trade, current_time: datetime) -> bool:
        """
        Determine whether the trade should be partially exited with slices.
        This method is only intended to be called from strategy callbacks.
        """
        dataframe, _ = self.dp.get_analyzed_dataframe(
            trade.pair, self.timeframe
        )

        if dataframe.empty:
            return False

        last_candle = dataframe.iloc[-1]
        rsi = last_candle["rsi"]

        if trade.is_short:
            return rsi < 45

        return rsi > 55

    def custom_stake_amount(self, pair: str, current_time: datetime, current_rate: float,
                             proposed_stake: float, min_stake: float | None, max_stake: float,
                             leverage: float, entry_tag: str | None, side: str,
                             **kwargs) -> float:

        return proposed_stake / self.twap_num_slices


    def adjust_trade_position(self, trade: Trade, current_time: datetime,
                               current_rate: float, current_profit: float,
                               min_stake: float | None, max_stake: float,
                               current_entry_rate: float, current_exit_rate: float,
                               current_entry_profit: float, current_exit_profit: float,
                               **kwargs
                               ) -> float | None | tuple[float | None, str | None]:


        if trade.has_open_orders:
            return None

        filled_entries = trade.select_filled_orders(trade.entry_side)
        entry_slices_done = len(filled_entries)
        filled_exits = trade.select_filled_orders(trade.exit_side)
        exit_slices_done = len(filled_exits)

        already_exiting = exit_slices_done > 0

        if already_exiting or self.should_exit_partially(trade, current_time):
            return self._next_exit_slice(trade, current_time, filled_exits, exit_slices_done)

        if entry_slices_done < self.twap_num_slices:
            return self._next_entry_slice(trade, current_time, filled_entries, entry_slices_done)

        return None

    def _next_entry_slice(self, trade: Trade, current_time: datetime,
                           filled_entries: list, slices_done: int
                           ) -> float | None | tuple[float | None, str | None]:


        last_fill_time = filled_entries[-1].order_filled_utc if filled_entries else trade.open_date_utc
        next_slice_due_at = last_fill_time + timedelta(minutes=self.twap_interval_minutes)
        if current_time < next_slice_due_at:
            return None


        stake_already_filled = sum(o.stake_amount_filled for o in filled_entries)
        twap_total_stake = filled_entries[0].stake_amount_filled * self.twap_num_slices
        remaining_stake = twap_total_stake - stake_already_filled
        remaining_slices = self.twap_num_slices - slices_done


        next_slice_stake = remaining_stake if remaining_slices <= 1 else remaining_stake / remaining_slices

        if next_slice_stake < 0:
            return None

        return next_slice_stake

    def _next_exit_slice(self, trade: Trade, current_time: datetime,
                          filled_exits: list, slices_done: int
                          ) -> float | None | tuple[float | None, str | None]:

        if slices_done >= self.twap_num_slices:
            return None

        last_fill_time = filled_exits[-1].order_filled_utc if filled_exits else current_time
        next_slice_due_at = last_fill_time + timedelta(minutes=self.twap_interval_minutes)
        if slices_done > 0 and current_time < next_slice_due_at:
            return None

        remaining_slices = self.twap_num_slices - slices_done


        if remaining_slices <= 1:

            return -trade.stake_amount

        slice_stake = trade.stake_amount / remaining_slices
        return -slice_stake
