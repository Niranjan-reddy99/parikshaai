import builtins
import sys

_real_print = builtins.print

def safe_print(*args, **kwargs):
    try:
        _real_print(*args, **kwargs)
        # Force flush to avoid buffering issues on detached terminals
        if kwargs.get('flush', False) is False:
            sys.stdout.flush()
    except BrokenPipeError:
        # Ignore broken pipe on stdout
        pass
    except Exception:
        pass

builtins.print = safe_print
