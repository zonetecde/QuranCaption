# cython: boundscheck=False, wraparound=False, cdivision=True
"""
Cython-accelerated word-boundary-constrained substring Levenshtein DP
with wraparound support for repetition detection.

When max_wraps=0, uses rolling rows (identical to the old standard DP).
When max_wraps>0, uses full 3D matrix with parent pointers for traceback.
"""

from libc.stdlib cimport malloc, free
from libc.math cimport INFINITY, fabs

# ---------------------------------------------------------------------------
# Phoneme → integer encoding (built lazily on first call)
# ---------------------------------------------------------------------------

cdef dict _phoneme_to_id = {}
cdef int _num_phonemes = 0
cdef double *_sub_matrix = NULL   # flat _num_phonemes × _num_phonemes
cdef double _default_sub = 1.0


cdef int _encode_phoneme(str p):
    """Return integer id for *p*, assigning a new one if unseen."""
    global _num_phonemes
    cdef int pid
    try:
        pid = _phoneme_to_id[p]
    except KeyError:
        pid = _num_phonemes
        _phoneme_to_id[p] = pid
        _num_phonemes += 1
    return pid


def init_substitution_matrix(dict sub_costs, double default_sub):
    """Build the dense substitution-cost matrix from the Python dict.

    Must be called once before the first DP call (phoneme_matcher.py does
    this at import time).

    Parameters
    ----------
    sub_costs : dict[(str, str), float]
        Phoneme-pair substitution costs (both orderings already present).
    default_sub : float
        Cost used for pairs not in *sub_costs*.
    """
    global _sub_matrix, _default_sub, _num_phonemes

    _default_sub = default_sub

    # First pass: make sure every phoneme in sub_costs has an id
    for (a, b) in sub_costs:
        _encode_phoneme(a)
        _encode_phoneme(b)

    # Allocate matrix (will be re-allocated if new phonemes appear later)
    _rebuild_matrix(sub_costs)


cdef void _rebuild_matrix(dict sub_costs):
    """(Re)allocate and fill the dense cost matrix."""
    global _sub_matrix, _num_phonemes, _default_sub

    cdef int size = _num_phonemes
    cdef int i, j

    if _sub_matrix != NULL:
        free(_sub_matrix)

    _sub_matrix = <double *>malloc(size * size * sizeof(double))
    if _sub_matrix == NULL:
        raise MemoryError("Failed to allocate substitution matrix")

    # Fill with default
    for i in range(size * size):
        _sub_matrix[i] = _default_sub

    # Diagonal = 0 (match)
    for i in range(size):
        _sub_matrix[i * size + i] = 0.0

    # Overrides from dict
    cdef int aid, bid
    cdef double cost
    for (a, b), cost in sub_costs.items():
        aid = _phoneme_to_id.get(a, -1)
        bid = _phoneme_to_id.get(b, -1)
        if aid >= 0 and bid >= 0:
            _sub_matrix[aid * size + bid] = cost


cdef inline double _get_sub_cost(int pid, int rid, int size) nogil:
    """Look up substitution cost from the dense matrix."""
    if pid == rid:
        return 0.0
    if pid < size and rid < size:
        return _sub_matrix[pid * size + rid]
    return _default_sub


# ---------------------------------------------------------------------------
# Helper: grow matrix when new phonemes are encountered at runtime
# ---------------------------------------------------------------------------

cdef void _grow_matrix():
    """Expand the substitution matrix to cover newly added phonemes.

    New rows/columns are filled with the default substitution cost,
    diagonal with 0.0.  Existing entries are preserved.
    """
    global _sub_matrix, _num_phonemes

    cdef int new_size = _num_phonemes
    cdef double *new_mat
    cdef int i

    if _sub_matrix == NULL:
        _sub_matrix = <double *>malloc(new_size * new_size * sizeof(double))
        if _sub_matrix == NULL:
            return
        for i in range(new_size * new_size):
            _sub_matrix[i] = _default_sub
        for i in range(new_size):
            _sub_matrix[i * new_size + i] = 0.0
        return

    new_mat = <double *>malloc(new_size * new_size * sizeof(double))
    if new_mat == NULL:
        return

    for i in range(new_size * new_size):
        new_mat[i] = _default_sub
    for i in range(new_size):
        new_mat[i * new_size + i] = 0.0

    free(_sub_matrix)
    _sub_matrix = new_mat


# ---------------------------------------------------------------------------
# Shared: encode inputs and precompute boundaries
# ---------------------------------------------------------------------------

cdef struct EncodedInput:
    int *P_ids
    int *R_ids
    int *R_w
    char *start_bd
    char *end_bd
    int *ws_pos      # word-start positions (sorted)
    int *we_pos      # word-end positions (sorted)
    int n_ws         # count of word-start positions
    int n_we         # count of word-end positions
    int mat_size     # phoneme matrix size at time of encoding
    int m            # len(P)
    int n            # len(R)


cdef EncodedInput _encode_inputs(list P_list, list R_list, list R_phone_to_word_list) except *:
    """Encode string lists to C arrays, precompute word boundaries."""
    cdef EncodedInput enc
    cdef int m = len(P_list)
    cdef int n = len(R_list)
    cdef int i, j
    cdef bint need_rebuild = False

    enc.m = m
    enc.n = n
    enc.P_ids = NULL
    enc.R_ids = NULL
    enc.R_w = NULL
    enc.start_bd = NULL
    enc.end_bd = NULL
    enc.ws_pos = NULL
    enc.we_pos = NULL

    enc.P_ids = <int *>malloc(m * sizeof(int))
    enc.R_ids = <int *>malloc(n * sizeof(int))
    enc.R_w = <int *>malloc(n * sizeof(int))
    if enc.P_ids == NULL or enc.R_ids == NULL or enc.R_w == NULL:
        _free_encoded(&enc)
        raise MemoryError()

    for i in range(m):
        p = P_list[i]
        if p not in _phoneme_to_id:
            _encode_phoneme(p)
            need_rebuild = True
        enc.P_ids[i] = _phoneme_to_id[p]

    for j in range(n):
        r = R_list[j]
        if r not in _phoneme_to_id:
            _encode_phoneme(r)
            need_rebuild = True
        enc.R_ids[j] = _phoneme_to_id[r]
        enc.R_w[j] = <int>R_phone_to_word_list[j]

    if need_rebuild and _sub_matrix != NULL:
        _grow_matrix()

    enc.mat_size = _num_phonemes

    # Precompute boundary flags
    enc.start_bd = <char *>malloc((n + 1) * sizeof(char))
    enc.end_bd = <char *>malloc((n + 1) * sizeof(char))
    if enc.start_bd == NULL or enc.end_bd == NULL:
        _free_encoded(&enc)
        raise MemoryError()

    enc.start_bd[0] = 1
    for j in range(1, n):
        enc.start_bd[j] = 1 if enc.R_w[j] != enc.R_w[j - 1] else 0
    enc.start_bd[n] = 0

    enc.end_bd[0] = 0
    for j in range(1, n):
        enc.end_bd[j] = 1 if enc.R_w[j] != enc.R_w[j - 1] else 0
    enc.end_bd[n] = 1

    # Build sorted arrays of boundary positions
    enc.n_ws = 0
    enc.n_we = 0
    for j in range(n + 1):
        if enc.start_bd[j]: enc.n_ws += 1
        if enc.end_bd[j]: enc.n_we += 1

    enc.ws_pos = <int *>malloc(enc.n_ws * sizeof(int))
    enc.we_pos = <int *>malloc(enc.n_we * sizeof(int))
    if enc.ws_pos == NULL or enc.we_pos == NULL:
        _free_encoded(&enc)
        raise MemoryError()

    cdef int ws_i = 0, we_i = 0
    for j in range(n + 1):
        if enc.start_bd[j]:
            enc.ws_pos[ws_i] = j; ws_i += 1
        if enc.end_bd[j]:
            enc.we_pos[we_i] = j; we_i += 1

    return enc


cdef void _free_encoded(EncodedInput *enc):
    """Free all arrays in an EncodedInput."""
    if enc.P_ids != NULL: free(enc.P_ids)
    if enc.R_ids != NULL: free(enc.R_ids)
    if enc.R_w != NULL: free(enc.R_w)
    if enc.start_bd != NULL: free(enc.start_bd)
    if enc.end_bd != NULL: free(enc.end_bd)
    if enc.ws_pos != NULL: free(enc.ws_pos)
    if enc.we_pos != NULL: free(enc.we_pos)
    enc.P_ids = NULL
    enc.R_ids = NULL
    enc.R_w = NULL
    enc.start_bd = NULL
    enc.end_bd = NULL
    enc.ws_pos = NULL
    enc.we_pos = NULL


# ---------------------------------------------------------------------------
# Rolling-row DP for max_wraps=0 (fast path, 89% of segments)
# ---------------------------------------------------------------------------

cdef tuple _align_rolling(
    EncodedInput *enc,
    int expected_word,
    double prior_weight,
    double cost_sub,
    double cost_del,
    double cost_ins,
):
    """Standard word-boundary DP using rolling rows. No wraparound."""
    cdef int m = enc.m, n = enc.n
    cdef int mat_size = enc.mat_size
    cdef double INF_VAL = INFINITY

    # Allocate rolling rows
    cdef double *prev_cost = <double *>malloc((n + 1) * sizeof(double))
    cdef double *curr_cost = <double *>malloc((n + 1) * sizeof(double))
    cdef int *prev_start = <int *>malloc((n + 1) * sizeof(int))
    cdef int *curr_start = <int *>malloc((n + 1) * sizeof(int))
    if prev_cost == NULL or curr_cost == NULL or prev_start == NULL or curr_start == NULL:
        if prev_cost != NULL: free(prev_cost)
        if curr_cost != NULL: free(curr_cost)
        if prev_start != NULL: free(prev_start)
        if curr_start != NULL: free(curr_start)
        raise MemoryError()

    cdef int i, j
    cdef double del_option, ins_option, sub_option, sc
    cdef double *tmp_d
    cdef int *tmp_i
    cdef bint col0_start = enc.start_bd[0]

    # Initialize row 0
    for j in range(n + 1):
        if enc.start_bd[j]:
            prev_cost[j] = 0.0
            prev_start[j] = j
        else:
            prev_cost[j] = INF_VAL
            prev_start[j] = -1

    # Core DP loop
    for i in range(1, m + 1):
        if col0_start:
            curr_cost[0] = i * cost_del
            curr_start[0] = 0
        else:
            curr_cost[0] = INF_VAL
            curr_start[0] = -1

        for j in range(1, n + 1):
            del_option = prev_cost[j] + cost_del
            ins_option = curr_cost[j - 1] + cost_ins
            sc = _get_sub_cost(enc.P_ids[i - 1], enc.R_ids[j - 1], mat_size)
            sub_option = prev_cost[j - 1] + sc

            if sub_option <= del_option and sub_option <= ins_option:
                curr_cost[j] = sub_option
                curr_start[j] = prev_start[j - 1]
            elif del_option <= ins_option:
                curr_cost[j] = del_option
                curr_start[j] = prev_start[j]
            else:
                curr_cost[j] = ins_option
                curr_start[j] = curr_start[j - 1]

        tmp_d = prev_cost; prev_cost = curr_cost; curr_cost = tmp_d
        tmp_i = prev_start; prev_start = curr_start; curr_start = tmp_i

    # Best-match selection
    cdef double best_score = INF_VAL
    cdef int best_j = -1, best_j_start = -1
    cdef double best_cost_val = INF_VAL, best_norm = INF_VAL
    cdef double dist, norm_dist, prior, score
    cdef int j_start_val, ref_len, denom, start_word

    for j in range(1, n + 1):
        if not enc.end_bd[j]:
            continue
        if prev_cost[j] >= INF_VAL:
            continue

        dist = prev_cost[j]
        j_start_val = prev_start[j]

        ref_len = j - j_start_val
        denom = m if m > ref_len else ref_len
        if denom < 1:
            denom = 1
        norm_dist = dist / denom

        if j_start_val < n:
            start_word = enc.R_w[j_start_val]
        else:
            start_word = enc.R_w[j - 1]

        prior = prior_weight * fabs(<double>(start_word - expected_word))
        score = norm_dist + prior

        if score < best_score:
            best_score = score
            best_j = j
            best_j_start = j_start_val
            best_cost_val = dist
            best_norm = norm_dist

    free(prev_cost); free(curr_cost)
    free(prev_start); free(curr_start)

    if best_j < 0:
        return (None, None, float('inf'), float('inf'), 0, 0, [])

    return (best_j, best_j_start, best_cost_val, best_norm, 0, best_j, [])


# ---------------------------------------------------------------------------
# Full 3D DP for max_wraps>0 (with traceback)
# ---------------------------------------------------------------------------

cdef tuple _align_full_3d(
    EncodedInput *enc,
    int expected_word,
    double prior_weight,
    double cost_sub,
    double cost_del,
    double cost_ins,
    double wrap_penalty,
    int max_wraps,
    int sc_mode,           # 0=subtract, 1=no_subtract, 2=additive
    double wrap_score_cost,
    double wrap_span_weight,
):
    """Wraparound DP with full 3D matrix and parent pointers for traceback."""
    cdef int m = enc.m, n = enc.n
    cdef int K = max_wraps
    cdef int mat_size = enc.mat_size
    cdef double INF_VAL = INFINITY

    # 3D indexing: [i * layer_stride + k * col_stride + j]
    cdef int col_stride = n + 1
    cdef int layer_stride = (K + 1) * col_stride
    cdef long total_3d = <long>(m + 1) * layer_stride

    # Allocate 3D arrays
    cdef double *cost_3d = NULL
    cdef int *start_3d = NULL
    cdef int *max_j_3d = NULL
    cdef int *min_w_3d = NULL  # minimum word index reached along path
    cdef int *par_i = NULL
    cdef int *par_k = NULL
    cdef int *par_j = NULL
    cdef char *par_t = NULL  # 0=sub, 1=del, 2=ins, 3=wrap
    cdef int BIG_W = 999999

    cost_3d = <double *>malloc(total_3d * sizeof(double))
    start_3d = <int *>malloc(total_3d * sizeof(int))
    max_j_3d = <int *>malloc(total_3d * sizeof(int))
    min_w_3d = <int *>malloc(total_3d * sizeof(int))
    par_i = <int *>malloc(total_3d * sizeof(int))
    par_k = <int *>malloc(total_3d * sizeof(int))
    par_j = <int *>malloc(total_3d * sizeof(int))
    par_t = <char *>malloc(total_3d * sizeof(char))

    if (cost_3d == NULL or start_3d == NULL or max_j_3d == NULL or min_w_3d == NULL or
            par_i == NULL or par_k == NULL or par_j == NULL or par_t == NULL):
        if cost_3d != NULL: free(cost_3d)
        if start_3d != NULL: free(start_3d)
        if max_j_3d != NULL: free(max_j_3d)
        if min_w_3d != NULL: free(min_w_3d)
        if par_i != NULL: free(par_i)
        if par_k != NULL: free(par_k)
        if par_j != NULL: free(par_j)
        if par_t != NULL: free(par_t)
        raise MemoryError()

    cdef long idx
    cdef int i, j, k
    cdef int koff, koff_src, koff_dst
    cdef long base_i, base_prev
    cdef int w_j, mw_val

    # Initialize all to INF / -1
    for idx in range(total_3d):
        cost_3d[idx] = INF_VAL
        start_3d[idx] = -1
        max_j_3d[idx] = -1
        min_w_3d[idx] = BIG_W
        par_i[idx] = -1
        par_k[idx] = -1
        par_j[idx] = -1
        par_t[idx] = -1

    # Row 0, k=0: free starts at word boundaries
    for j in range(n + 1):
        if enc.start_bd[j]:
            cost_3d[j] = 0.0    # i=0, k=0, j
            start_3d[j] = j
            max_j_3d[j] = j
            min_w_3d[j] = enc.R_w[j] if j < n else BIG_W

    # Variables for DP transitions
    cdef double del_opt, ins_opt, sub_opt, sc, new_cost, cost_at_end, best_val
    cdef int j_end, j_sw, mj_val, word_span
    cdef int we_i, ws_i

    # Fill DP
    for i in range(1, m + 1):
        base_i = <long>i * layer_stride
        base_prev = <long>(i - 1) * layer_stride

        # Standard transitions for each k
        for k in range(K + 1):
            koff = k * col_stride

            # Column 0: deletion base case, k=0 only
            if k == 0 and enc.start_bd[0]:
                idx = base_i + koff
                cost_3d[idx] = i * cost_del
                start_3d[idx] = 0
                max_j_3d[idx] = 0
                min_w_3d[idx] = min_w_3d[base_prev + koff]
                par_i[idx] = i - 1
                par_k[idx] = 0
                par_j[idx] = 0
                par_t[idx] = 1  # del

            for j in range(1, n + 1):
                idx = base_i + koff + j

                # Deletion: prev row, same j, same k
                del_opt = INF_VAL
                if cost_3d[base_prev + koff + j] < INF_VAL:
                    del_opt = cost_3d[base_prev + koff + j] + cost_del

                # Insertion: same row, j-1, same k
                ins_opt = INF_VAL
                if cost_3d[base_i + koff + j - 1] < INF_VAL:
                    ins_opt = cost_3d[base_i + koff + j - 1] + cost_ins

                # Substitution: prev row, j-1, same k
                sub_opt = INF_VAL
                if cost_3d[base_prev + koff + j - 1] < INF_VAL:
                    sc = _get_sub_cost(enc.P_ids[i - 1], enc.R_ids[j - 1], mat_size)
                    sub_opt = cost_3d[base_prev + koff + j - 1] + sc

                if sub_opt <= del_opt and sub_opt <= ins_opt:
                    cost_3d[idx] = sub_opt
                    start_3d[idx] = start_3d[base_prev + koff + j - 1]
                    mj_val = max_j_3d[base_prev + koff + j - 1]
                    max_j_3d[idx] = j if j > mj_val else mj_val
                    w_j = enc.R_w[j - 1]
                    mw_val = min_w_3d[base_prev + koff + j - 1]
                    min_w_3d[idx] = w_j if w_j < mw_val else mw_val
                    par_i[idx] = i - 1; par_k[idx] = k; par_j[idx] = j - 1; par_t[idx] = 0
                elif del_opt <= ins_opt:
                    cost_3d[idx] = del_opt
                    start_3d[idx] = start_3d[base_prev + koff + j]
                    max_j_3d[idx] = max_j_3d[base_prev + koff + j]
                    min_w_3d[idx] = min_w_3d[base_prev + koff + j]
                    par_i[idx] = i - 1; par_k[idx] = k; par_j[idx] = j; par_t[idx] = 1
                elif ins_opt < INF_VAL:
                    cost_3d[idx] = ins_opt
                    start_3d[idx] = start_3d[base_i + koff + j - 1]
                    mj_val = max_j_3d[base_i + koff + j - 1]
                    max_j_3d[idx] = j if j > mj_val else mj_val
                    w_j = enc.R_w[j - 1]
                    mw_val = min_w_3d[base_i + koff + j - 1]
                    min_w_3d[idx] = w_j if w_j < mw_val else mw_val
                    par_i[idx] = i; par_k[idx] = k; par_j[idx] = j - 1; par_t[idx] = 2

        # Wrap transitions (within same row i)
        for k in range(K):
            koff_src = k * col_stride
            koff_dst = (k + 1) * col_stride

            for we_i in range(enc.n_we):
                j_end = enc.we_pos[we_i]
                if cost_3d[base_i + koff_src + j_end] >= INF_VAL:
                    continue
                cost_at_end = cost_3d[base_i + koff_src + j_end]

                for ws_i in range(enc.n_ws):
                    j_sw = enc.ws_pos[ws_i]
                    if j_sw >= j_end:
                        continue
                    word_span = enc.R_w[j_end - 1] - enc.R_w[j_sw]
                    if word_span < 0:
                        word_span = -word_span
                    new_cost = cost_at_end + wrap_penalty + wrap_span_weight * word_span
                    idx = base_i + koff_dst + j_sw
                    if new_cost < cost_3d[idx]:
                        cost_3d[idx] = new_cost
                        start_3d[idx] = start_3d[base_i + koff_src + j_end]
                        mj_val = max_j_3d[base_i + koff_src + j_end]
                        max_j_3d[idx] = j_end if j_end > mj_val else mj_val
                        mw_val = min_w_3d[base_i + koff_src + j_end]
                        w_j = enc.R_w[j_sw]
                        min_w_3d[idx] = w_j if w_j < mw_val else mw_val
                        par_i[idx] = i; par_k[idx] = k; par_j[idx] = j_end; par_t[idx] = 3

            # Insertion re-sweep from wrap positions
            for j in range(1, n + 1):
                idx = base_i + koff_dst + j
                ins_opt = cost_3d[base_i + koff_dst + j - 1] + cost_ins \
                          if cost_3d[base_i + koff_dst + j - 1] < INF_VAL else INF_VAL
                if ins_opt < cost_3d[idx]:
                    cost_3d[idx] = ins_opt
                    start_3d[idx] = start_3d[base_i + koff_dst + j - 1]
                    mj_val = max_j_3d[base_i + koff_dst + j - 1]
                    max_j_3d[idx] = j if j > mj_val else mj_val
                    w_j = enc.R_w[j - 1]
                    mw_val = min_w_3d[base_i + koff_dst + j - 1]
                    min_w_3d[idx] = w_j if w_j < mw_val else mw_val
                    par_i[idx] = i; par_k[idx] = k + 1; par_j[idx] = j - 1; par_t[idx] = 2

    # ------------------------------------------------------------------
    # Best-match selection (end boundaries only, across all k)
    # ------------------------------------------------------------------
    cdef double best_score = INF_VAL
    cdef int best_j = -1, best_j_start = -1
    cdef double best_cost_val = INF_VAL, best_norm = INF_VAL
    cdef int best_k_val = 0, best_max_j = -1

    cdef double dist, norm_dist, prior, score, phoneme_cost
    cdef int j_start_val, ref_len, denom, start_word, max_j_val, min_word_val, eff_start

    base_i = <long>m * layer_stride
    for k in range(K + 1):
        koff = k * col_stride
        for j in range(1, n + 1):
            if not enc.end_bd[j]:
                continue
            idx = base_i + koff + j
            if cost_3d[idx] >= INF_VAL:
                continue

            dist = cost_3d[idx]
            j_start_val = start_3d[idx]
            if j_start_val < 0:
                continue

            max_j_val = max_j_3d[idx]
            ref_len = (max_j_val if max_j_val > j else j) - j_start_val
            if ref_len <= 0:
                continue
            denom = m if m > ref_len else ref_len
            if denom < 1:
                denom = 1

            if sc_mode == 1:   # no_subtract
                phoneme_cost = dist
            else:              # subtract or additive
                phoneme_cost = dist - k * wrap_penalty
            norm_dist = phoneme_cost / denom

            if j_start_val < n:
                start_word = enc.R_w[j_start_val]
            else:
                start_word = enc.R_w[j - 1]

            # Use earliest word the path actually touches for fair prior
            min_word_val = min_w_3d[idx]
            eff_start = min_word_val if min_word_val < start_word and min_word_val < BIG_W else start_word
            prior = prior_weight * fabs(<double>(eff_start - expected_word))
            score = norm_dist + prior
            if sc_mode == 2:   # additive
                score = score + k * wrap_score_cost

            if score < best_score:
                best_score = score
                best_j = j
                best_j_start = j_start_val
                best_cost_val = dist
                best_norm = norm_dist
                best_k_val = k
                best_max_j = max_j_val

    if best_j < 0:
        free(cost_3d); free(start_3d); free(max_j_3d); free(min_w_3d)
        free(par_i); free(par_k); free(par_j); free(par_t)
        return (None, None, float('inf'), float('inf'), 0, 0, [])

    # ------------------------------------------------------------------
    # Traceback: walk parent pointers, collect wrap points
    # ------------------------------------------------------------------
    wrap_points = []
    cdef int ci = m, ck = best_k_val, cj = best_j
    cdef int pi, pk, pj
    cdef char pt

    while True:
        idx = <long>ci * layer_stride + ck * col_stride + cj
        if par_i[idx] < 0:
            break
        pi = par_i[idx]
        pk = par_k[idx]
        pj = par_j[idx]
        pt = par_t[idx]
        if pt == 3:  # wrap
            # Wrap: at P position ci, R jumped from pj (j_end) back to cj (j_start)
            wrap_points.append((ci, pj, cj))
        ci = pi; ck = pk; cj = pj

    wrap_points.reverse()  # chronological order

    free(cost_3d); free(start_3d); free(max_j_3d)
    free(par_i); free(par_k); free(par_j); free(par_t)

    return (best_j, best_j_start, best_cost_val, best_norm, best_k_val, best_max_j, wrap_points)


# ---------------------------------------------------------------------------
# Public API: unified wraparound DP
# ---------------------------------------------------------------------------

def cy_align_wraparound(
    list P_list,
    list R_list,
    list R_phone_to_word_list,
    int expected_word,
    double prior_weight,
    double cost_sub,
    double cost_del,
    double cost_ins,
    double wrap_penalty = 2.0,
    int max_wraps = 0,
    str scoring_mode = "subtract",
    double wrap_score_cost = 0.01,
    double wrap_span_weight = 0.1,
):
    """Wraparound word-boundary-constrained substring alignment (Cython).

    When max_wraps=0, uses rolling rows (fast path, no traceback needed).
    When max_wraps>0, uses full 3D matrix with parent pointers for traceback.

    Returns (best_j, best_j_start, best_cost, best_norm_dist, best_k, best_max_j, wrap_points).
    wrap_points: list of (i, j_end, j_start) — P position and R positions of each wrap.
    Empty list when no wraps detected.

    scoring_mode:
        "subtract"    — phoneme_cost = dist - k*wrap_penalty (wrap is free in score)
        "no_subtract" — phoneme_cost = dist (wrap penalty stays in score)
        "additive"    — phoneme_cost = dist - k*wrap_penalty, score += k*wrap_score_cost
    """
    cdef int m = len(P_list)
    cdef int n = len(R_list)

    if m == 0 or n == 0:
        return (None, None, float('inf'), float('inf'), 0, 0, [])

    # Encode inputs
    cdef EncodedInput enc = _encode_inputs(P_list, R_list, R_phone_to_word_list)

    # Encode scoring mode outside of branches (cdef not allowed inside if blocks)
    cdef int sc_mode
    if scoring_mode == "no_subtract":
        sc_mode = 1
    elif scoring_mode == "additive":
        sc_mode = 2
    else:
        sc_mode = 0

    cdef tuple result
    try:
        if max_wraps == 0:
            # Fast path: rolling rows, no wraparound
            result = _align_rolling(
                &enc, expected_word, prior_weight,
                cost_sub, cost_del, cost_ins,
            )
        else:
            result = _align_full_3d(
                &enc, expected_word, prior_weight,
                cost_sub, cost_del, cost_ins,
                wrap_penalty, max_wraps,
                sc_mode, wrap_score_cost,
                wrap_span_weight,
            )
    finally:
        _free_encoded(&enc)

    return result
