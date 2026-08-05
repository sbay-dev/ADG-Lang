namespace Adg.NativeCompiler;

/// <summary>
/// The ADG Refine Runtime: a fixed support library, analogous to crt0/libc,
/// that every ADG text-refiner executable links against. It contains only
/// mechanical text plumbing (read input, tokenize on whitespace, look a token's
/// skeleton up in the ADG-emitted lexicon, apply ADG-emitted normalization
/// flags, write output). All language-specific decision data — the lexicon and
/// the flags — is emitted as IR by the ADG compiler, never hard-coded here.
/// The skeletonization rule mirrors <see cref="ArabicText.Skeletonize"/> exactly.
/// </summary>
internal static class RefineRuntime
{
    public const string FileName = "adg_refine_runtime.c";

    public static string WriteTo(string directory)
    {
        var path = Path.Combine(directory, FileName);
        File.WriteAllText(path, CSource, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        return path;
    }

    private const string CSource = @"/* ADG Refine Runtime - fixed support library for ADG text-refiner programs.
 * Generated and linked by the ADG native compiler. Do not edit by hand.
 *
 * The ADG compiler emits a program's identity (its lexicon, its normalization
 * flags and main); this runtime provides only mechanical plumbing. It carries
 * no embedded word list and no language rules beyond UTF-8 byte handling of
 * Arabic tashkeel (U+064B..U+065F, U+0670) and tatweel (U+0640). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Decision data supplied by the ADG-generated LLVM IR module. */
extern const char *const adg_lex_keys[];
extern const char *const adg_lex_vals[];
extern const int adg_lex_count;
extern const int adg_flag_collapse_spaces;
extern const int adg_flag_remove_tatweel;
extern const int adg_flag_strip_tashkeel;

static const char adg_one_space[2] = { ' ', '\0' };

static int adg_is_tatweel(unsigned char a, unsigned char b)
{
    return a == 0xD9u && b == 0x80u;
}

static int adg_is_tashkeel(unsigned char a, unsigned char b)
{
    if (a != 0xD9u)
    {
        return 0;
    }
    if (b >= 0x8Bu && b <= 0x9Fu)
    {
        return 1;
    }
    return b == 0xB0u;
}

static int adg_is_space(unsigned char c)
{
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
}

/* Remove every tashkeel mark and every tatweel: the consonantal skeleton. */
static char *adg_skeletonize(const char *s)
{
    size_t n = strlen(s);
    char *out = (char *)malloc(n + 1);
    size_t i = 0, o = 0;
    if (!out)
    {
        return NULL;
    }
    while (i < n)
    {
        unsigned char a = (unsigned char)s[i];
        unsigned char b = (i + 1 < n) ? (unsigned char)s[i + 1] : 0u;
        if (adg_is_tatweel(a, b) || adg_is_tashkeel(a, b))
        {
            i += 2;
            continue;
        }
        out[o++] = s[i++];
    }
    out[o] = '\0';
    return out;
}

/* Apply only the enabled normalization flags to a token with no lexicon match. */
static char *adg_normalize(const char *s)
{
    size_t n = strlen(s);
    char *out = (char *)malloc(n + 1);
    size_t i = 0, o = 0;
    if (!out)
    {
        return NULL;
    }
    while (i < n)
    {
        unsigned char a = (unsigned char)s[i];
        unsigned char b = (i + 1 < n) ? (unsigned char)s[i + 1] : 0u;
        if (adg_flag_remove_tatweel && adg_is_tatweel(a, b))
        {
            i += 2;
            continue;
        }
        if (adg_flag_strip_tashkeel && adg_is_tashkeel(a, b))
        {
            i += 2;
            continue;
        }
        out[o++] = s[i++];
    }
    out[o] = '\0';
    return out;
}

static const char *adg_lookup(const char *skeleton)
{
    int i;
    for (i = 0; i < adg_lex_count; i++)
    {
        if (strcmp(adg_lex_keys[i], skeleton) == 0)
        {
            return adg_lex_vals[i];
        }
    }
    return NULL;
}

static void adg_emit_token(const char *tok)
{
    char *sk = adg_skeletonize(tok);
    const char *hit = sk ? adg_lookup(sk) : NULL;
    if (hit)
    {
        fputs(hit, stdout);
    }
    else
    {
        char *nm = adg_normalize(tok);
        fputs(nm ? nm : tok, stdout);
        free(nm);
    }
    free(sk);
}

static char *adg_read_all_stdin(void)
{
    size_t cap = 4096, len = 0;
    char *buf = (char *)malloc(cap);
    int c;
    if (!buf)
    {
        return NULL;
    }
    while ((c = getchar()) != EOF)
    {
        if (len + 1 >= cap)
        {
            char *grown;
            cap *= 2;
            grown = (char *)realloc(buf, cap);
            if (!grown)
            {
                free(buf);
                return NULL;
            }
            buf = grown;
        }
        buf[len++] = (char)c;
    }
    buf[len] = '\0';
    return buf;
}

static char *adg_join_args(int argc, char **argv)
{
    size_t total = 1;
    int i;
    char *buf;
    for (i = 1; i < argc; i++)
    {
        total += strlen(argv[i]) + 1;
    }
    buf = (char *)malloc(total);
    if (!buf)
    {
        return NULL;
    }
    buf[0] = '\0';
    for (i = 1; i < argc; i++)
    {
        if (i > 1)
        {
            strcat(buf, adg_one_space);
        }
        strcat(buf, argv[i]);
    }
    return buf;
}

int adg_run(int argc, char **argv)
{
    char *input = (argc > 1) ? adg_join_args(argc, argv) : adg_read_all_stdin();
    size_t i = 0, n;
    int started = 0, pending_space = 0;
    if (!input)
    {
        return 1;
    }
    n = strlen(input);
    while (i < n)
    {
        unsigned char c = (unsigned char)input[i];
        if (adg_is_space(c))
        {
            if (adg_flag_collapse_spaces)
            {
                if (started)
                {
                    pending_space = 1;
                }
                i++;
                while (i < n && adg_is_space((unsigned char)input[i]))
                {
                    i++;
                }
            }
            else
            {
                putchar(input[i]);
                i++;
            }
        }
        else
        {
            size_t start, toklen;
            char *tok;
            if (pending_space)
            {
                putchar(' ');
                pending_space = 0;
            }
            start = i;
            while (i < n && !adg_is_space((unsigned char)input[i]))
            {
                i++;
            }
            toklen = i - start;
            tok = (char *)malloc(toklen + 1);
            if (!tok)
            {
                free(input);
                return 1;
            }
            memcpy(tok, input + start, toklen);
            tok[toklen] = '\0';
            adg_emit_token(tok);
            free(tok);
            started = 1;
        }
    }
    putchar('\n');
    free(input);
    fflush(stdout);
    return 0;
}
";
}
