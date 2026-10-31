import asyncio
import logging
import os
import signal

PARENT_PID_ENV = "LOWORK_PARENT_PID"
CHECK_INTERVAL_SECONDS = 2.0

logger = logging.getLogger(__name__)


def get_expected_parent_pid() -> int | None:
    """Tauriから起動されたときだけ、起動元のPIDを返す。手動起動ではNoneになる。"""
    value = os.environ.get(PARENT_PID_ENV)
    if value is None or not value.isdigit():
        return None
    return int(value)


async def watch_parent_process(parent_pid: int) -> None:
    """起動元のアプリが終了して孤児になったら、自分を止めてポートを解放する。"""
    while os.getppid() == parent_pid:
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    logger.info("起動元のアプリが終了したため、バックエンドを停止します")
    # uvicornの通常の終了処理（lifespanの後始末を含む）を走らせる
    os.kill(os.getpid(), signal.SIGTERM)


def start_parent_watch() -> asyncio.Task[None] | None:
    parent_pid = get_expected_parent_pid()
    if parent_pid is None:
        return None
    return asyncio.create_task(watch_parent_process(parent_pid))
