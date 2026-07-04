// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KycGate, IKycSBT} from "../src/KycGate.sol";

contract MockKycSBT is IKycSBT {
    struct Info {
        uint8 level;
        uint8 status;
    }

    mapping(address => Info) public infos;

    function set(address who, uint8 level, uint8 status) external {
        infos[who] = Info(level, status);
    }

    function isHuman(address account) external view returns (bool, uint8) {
        Info memory i = infos[account];
        return (i.status == 1, i.level);
    }

    function getKycInfo(address account)
        external
        view
        returns (string memory, uint8 level, uint8 status, uint256)
    {
        Info memory i = infos[account];
        return ("", i.level, i.status, 0);
    }
}

contract RevertingSBT {
    fallback() external {
        revert("boom");
    }
}

contract KycGateTest is Test {
    KycGate gate;
    MockKycSBT sbt;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        gate = new KycGate(1);
        sbt = new MockKycSBT();
    }

    function test_NoSbtNoDemo_Fails() public view {
        (bool ok, KycGate.KycMode mode,) = gate.checkKyc(alice);
        assertFalse(ok);
        assertEq(uint8(mode), uint8(KycGate.KycMode.None));
    }

    function test_DemoAttestation_Passes() public {
        gate.setDemoAttestation(alice, true, "hackathon demo wallet");
        (bool ok, KycGate.KycMode mode,) = gate.checkKyc(alice);
        assertTrue(ok);
        assertEq(uint8(mode), uint8(KycGate.KycMode.DemoAttestor));

        gate.setDemoAttestation(alice, false, "revoked");
        (ok,,) = gate.checkKyc(alice);
        assertFalse(ok);
    }

    function test_OfficialSbt_Passes() public {
        gate.setKycSBT(address(sbt), 1);
        sbt.set(alice, 2, 1); // ADVANCED, APPROVED
        (bool ok, KycGate.KycMode mode, uint8 level) = gate.checkKyc(alice);
        assertTrue(ok);
        assertEq(uint8(mode), uint8(KycGate.KycMode.OfficialSBT));
        assertEq(level, 2);
    }

    function test_OfficialSbt_BelowMinLevel_FallsToDemo() public {
        gate.setKycSBT(address(sbt), 3); // require PREMIUM
        sbt.set(alice, 2, 1); // only ADVANCED
        (bool ok,,) = gate.checkKyc(alice);
        assertFalse(ok);

        gate.setDemoAttestation(alice, true, "fallback");
        (bool ok2, KycGate.KycMode mode,) = gate.checkKyc(alice);
        assertTrue(ok2);
        assertEq(uint8(mode), uint8(KycGate.KycMode.DemoAttestor));
    }

    function test_OfficialSbt_Revoked_Fails() public {
        gate.setKycSBT(address(sbt), 1);
        sbt.set(alice, 2, 2); // REVOKED
        (bool ok,,) = gate.checkKyc(alice);
        assertFalse(ok);
    }

    function test_RevertingRegistry_FallsToDemo() public {
        gate.setKycSBT(address(new RevertingSBT()), 1);
        gate.setDemoAttestation(alice, true, "registry down");
        (bool ok, KycGate.KycMode mode,) = gate.checkKyc(alice);
        assertTrue(ok);
        assertEq(uint8(mode), uint8(KycGate.KycMode.DemoAttestor));
    }

    function test_RequireKyc_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(KycGate.NotKycVerified.selector, bob));
        gate.requireKyc(bob);
    }

    function test_OnlyOwner_Guards() public {
        vm.prank(bob);
        vm.expectRevert();
        gate.setDemoAttestation(bob, true, "nope");

        vm.prank(bob);
        vm.expectRevert();
        gate.setKycSBT(address(sbt), 1);
    }
}
