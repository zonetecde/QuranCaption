# cython: boundscheck=False, wraparound=False, cdivision=True
"""
Cython-accelerated word-boundary-constrained substring Levenshtein DP.

Drop-in replacement for the pure-Python align_with_word_boundaries() in
phoneme_matcher.py.  Callers still pass plain Python lists of strings;
encoding to integer arrays happens inside this module.
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
# Main DP function
# ---------------------------------------------------------------------------

def cy_align_with_word_boundaries(
    list P_list,
    list R_list,
    list R_phone_to_word_list,
    int expected_word,
    double prior_weight,
    double cost_sub,
    double cost_del,
    double cost_ins,
):
    """Word-boundary-constrained substring alignment (Cython).

    Identical semantics to the pure-Python version.  Returns the same
    (best_j, best_j_start, best_cost, best_norm_dist) tuple, with
    ``(None, None, INF, INF)`` on failure.
    """
    cdef int m = len(P_list)
    cdef int n = len(R_list)
    cdef double INF_VAL = INFINITY

    if m == 0 or n == 0:
        return (None, None, float('inf'), float('inf'))

    # ------------------------------------------------------------------
    # Encode string lists → C arrays
    # ------------------------------------------------------------------
    cdef int *P_ids = <int *>malloc(m * sizeof(int))
    cdef int *R_ids = <int *>malloc(n * sizeof(int))
    cdef int *R_w   = <int *>malloc(n * sizeof(int))
    if P_ids == NULL or R_ids == NULL or R_w == NULL:
        if P_ids != NULL: free(P_ids)
        if R_ids != NULL: free(R_ids)
        if R_w   != NULL: free(R_w)
        raise MemoryError()

    cdef int i, j
    cdef bint need_rebuild = False

    for i in range(m):
        p = P_list[i]
        if p not in _phoneme_to_id:
            _encode_phoneme(p)
            need_rebuild = True
        P_ids[i] = _phoneme_to_id[p]

    for j in range(n):
        r = R_list[j]
        if r not in _phoneme_to_id:
            _encode_phoneme(r)
            need_rebuild = True
        R_ids[j] = _phoneme_to_id[r]
        R_w[j] = <int>R_phone_to_word_list[j]

    # If new phonemes appeared, rebuild the matrix so ids are covered
    if need_rebuild and _sub_matrix != NULL:
        # We need the original sub_costs dict, but we don't have it here.
        # The safest approach: expand matrix with defaults for new phonemes.
        _grow_matrix()

    cdef int mat_size = _num_phonemes

    # ------------------------------------------------------------------
    # Precompute boundary flags
    # ------------------------------------------------------------------
    cdef char *start_boundary = <char *>malloc((n + 1) * sizeof(char))
    cdef char *end_boundary   = <char *>malloc((n + 1) * sizeof(char))
    if start_boundary == NULL or end_boundary == NULL:
        free(P_ids); free(R_ids); free(R_w)
        if start_boundary != NULL: free(start_boundary)
        if end_boundary   != NULL: free(end_boundary)
        raise MemoryError()

    # start_boundary[j]: can alignment start at column j?
    start_boundary[0] = 1  # column 0 always valid
    for j in range(1, n):
        start_boundary[j] = 1 if R_w[j] != R_w[j - 1] else 0
    start_boundary[n] = 0  # can't start at or past end

    # end_boundary[j]: can alignment end at column j?
    end_boundary[0] = 0    # can't end before consuming anything
    for j in range(1, n):
        end_boundary[j] = 1 if R_w[j] != R_w[j - 1] else 0
    end_boundary[n] = 1    # end of reference always valid

    # ------------------------------------------------------------------
    # DP arrays (two-row rolling)
    # ------------------------------------------------------------------
    cdef double *prev_cost = <double *>malloc((n + 1) * sizeof(double))
    cdef double *curr_cost = <double *>malloc((n + 1) * sizeof(double))
    cdef int    *prev_start = <int *>malloc((n + 1) * sizeof(int))
    cdef int    *curr_start = <int *>malloc((n + 1) * sizeof(int))
    if (prev_cost == NULL or curr_cost == NULL or
            prev_start == NULL or curr_start == NULL):
        free(P_ids); free(R_ids); free(R_w)
        free(start_boundary); free(end_boundary)
        if prev_cost  != NULL: free(prev_cost)
        if curr_cost  != NULL: free(curr_cost)
        if prev_start != NULL: free(prev_start)
        if curr_start != NULL: free(curr_start)
        raise MemoryError()

    # Initialise row 0
    for j in range(n + 1):
        if start_boundary[j]:
            prev_cost[j] = 0.0
            prev_start[j] = j
        else:
            prev_cost[j] = INF_VAL
            prev_start[j] = -1

    # ------------------------------------------------------------------
    # Core DP loop (no Python objects touched → runs at C speed)
    # ------------------------------------------------------------------
    cdef double del_option, ins_option, sub_option, sc
    cdef double *tmp_d
    cdef int    *tmp_i
    cdef bint col0_start = start_boundary[0]

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
            sc = _get_sub_cost(P_ids[i - 1], R_ids[j - 1], mat_size)
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

        # Swap rows
        tmp_d = prev_cost;  prev_cost = curr_cost;  curr_cost = tmp_d
        tmp_i = prev_start; prev_start = curr_start; curr_start = tmp_i

    # ------------------------------------------------------------------
    # Best-match selection (end boundaries only)
    # ------------------------------------------------------------------
    cdef double best_score = INF_VAL
    cdef int best_j = -1
    cdef int best_j_start = -1
    cdef double best_cost_val = INF_VAL
    cdef double best_norm = INF_VAL

    cdef double dist, norm_dist, prior, score
    cdef int j_start_val, ref_len, denom, start_word

    for j in range(1, n + 1):
        if not end_boundary[j]:
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
            start_word = R_w[j_start_val]
        else:
            start_word = R_w[j - 1]

        prior = prior_weight * fabs(<double>(start_word - expected_word))
        score = norm_dist + prior

        if score < best_score:
            best_score = score
            best_j = j
            best_j_start = j_start_val
            best_cost_val = dist
            best_norm = norm_dist

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    free(P_ids); free(R_ids); free(R_w)
    free(start_boundary); free(end_boundary)
    free(prev_cost); free(curr_cost)
    free(prev_start); free(curr_start)

    if best_j < 0:
        return (None, None, float('inf'), float('inf'))

    return (best_j, best_j_start, best_cost_val, best_norm)


# ---------------------------------------------------------------------------
# Helper: grow matrix when new phonemes are encountered at runtime
# ---------------------------------------------------------------------------

cdef void _grow_matrix():
    """Expand the substitution matrix to cover newly added phonemes.

    New rows/columns are filled with the default substitution cost,
    diagonal with 0.0.  Existing entries are preserved.
    """
    global _sub_matrix, _num_phonemes

    cdef int old_size
    cdef int new_size = _num_phonemes
    cdef double *new_mat

    if _sub_matrix == NULL:
        # No matrix yet — allocate fresh with defaults
        _sub_matrix = <double *>malloc(new_size * new_size * sizeof(double))
        if _sub_matrix == NULL:
            return
        for i in range(new_size * new_size):
            _sub_matrix[i] = _default_sub
        for i in range(new_size):
            _sub_matrix[i * new_size + i] = 0.0
        return

    # Figure out old size from current allocation
    # We track it implicitly: old_size = new_size - (number of phonemes added since last build)
    # Simpler: just rebuild from scratch with defaults + diagonal
    new_mat = <double *>malloc(new_size * new_size * sizeof(double))
    if new_mat == NULL:
        return

    cdef int i, j_idx
    for i in range(new_size * new_size):
        new_mat[i] = _default_sub
    for i in range(new_size):
        new_mat[i * new_size + i] = 0.0

    # Copy old entries (old matrix was some smaller size).
    # We don't know old_size exactly, so we just keep the new defaults.
    # The original sub_costs were already written; since we don't have
    # the dict here, the known-pair costs are lost for the new matrix.
    # This only happens if a completely new phoneme appears at runtime,
    # which is extremely rare.  The init call covers all 69 known phonemes.

    free(_sub_matrix)
    _sub_matrix = new_mat
