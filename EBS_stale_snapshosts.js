import {
    EC2Client,
    DescribeSnapshotsCommand,
    DescribeInstancesCommand,
    DescribeVolumesCommand,
    DeleteSnapshotCommand
} from "@aws-sdk/client-ec2";

export const handler = async (event, context) => {
    const ec2 = new EC2Client({ region: process.env.AWS_REGION });

    // Get all EBS snapshots
    const snapshotsResponse = await ec2.send(
        new DescribeSnapshotsCommand({
            OwnerIds: ["self"]
        })
    );

    // Get all running EC2 instances
    const instancesResponse = await ec2.send(
        new DescribeInstancesCommand({
            Filters: [
                {
                    Name: "instance-state-name",
                    Values: ["running"]
                }
            ]
        })
    );

    // Collect active instance IDs
    const activeInstanceIds = new Set();
    for (const reservation of instancesResponse.Reservations || []) {
        for (const instance of reservation.Instances || []) {
            activeInstanceIds.add(instance.InstanceId);
        }
    }

    // Iterate over snapshots
    for (const snapshot of snapshotsResponse.Snapshots || []) {
        const snapshotId = snapshot.SnapshotId;
        const volumeId = snapshot.VolumeId;

        if (!volumeId) {
            // Delete snapshots with no volume
            await ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId }));
            console.log(`Deleted EBS snapshot ${snapshotId} as it was not attached to any volume.`);
            continue;
        }

        try {
            // Check volume details
            const volumeResponse = await ec2.send(
                new DescribeVolumesCommand({
                    VolumeIds: [volumeId]
                })
            );

            const volume = volumeResponse.Volumes?.[0];

            if (!volume || !volume.Attachments || volume.Attachments.length === 0) {
                await ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId }));
                console.log(
                    `Deleted EBS snapshot ${snapshotId} as it was taken from a volume not attached to any running instance.`
                );
            }

        } catch (err) {
            // Handle Volume Not Found
            if (err.name === "InvalidVolume.NotFound" || err.Code === "InvalidVolume.NotFound") {
                await ec2.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId }));
                console.log(
                    `Deleted EBS snapshot ${snapshotId} as its associated volume was not found.`
                );
            } else {
                console.error(`Error checking volume for snapshot ${snapshotId}:`, err);
            }
        }
    }

    return { status: "Completed snapshot cleanup" };
};
