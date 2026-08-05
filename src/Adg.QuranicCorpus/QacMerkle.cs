using System.Security.Cryptography;
using System.Text;

namespace Adg.QuranicCorpus;

public static class QacMerkle
{
    public static byte[] HashRecord(QacMorphologyRecord record) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(record.CanonicalLine));

    public static string ComputeRoot(IReadOnlyList<byte[]> leaves)
    {
        if (leaves.Count == 0)
        {
            return Convert.ToHexString(SHA256.HashData([])).ToLowerInvariant();
        }

        var level = leaves.Select(leaf => leaf.ToArray()).ToList();
        while (level.Count > 1)
        {
            var next = new List<byte[]>((level.Count + 1) / 2);
            for (var index = 0; index < level.Count; index += 2)
            {
                var left = level[index];
                var right = index + 1 < level.Count ? level[index + 1] : left;
                var pair = new byte[left.Length + right.Length];
                Buffer.BlockCopy(left, 0, pair, 0, left.Length);
                Buffer.BlockCopy(right, 0, pair, left.Length, right.Length);
                next.Add(SHA256.HashData(pair));
            }

            level = next;
        }

        return Convert.ToHexString(level[0]).ToLowerInvariant();
    }
}
